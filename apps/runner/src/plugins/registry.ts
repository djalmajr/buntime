import { getLogger } from "@buntime/shared/logger";
import type { AppInfo, BuntimePlugin, PluginLogger, WorkerInstance } from "@buntime/shared/types";
import type { Server, ServerWebSocket } from "bun";

/**
 * Registry for managing loaded plugins
 */
export class PluginRegistry {
  private plugins: Map<string, BuntimePlugin> = new Map();
  private order: string[] = [];
  private mountedPaths: Map<string, string> = new Map(); // path -> pluginName
  private services: Map<string, unknown> = new Map(); // serviceName -> service

  /**
   * Register a service for other plugins to use
   */
  registerService<T>(name: string, service: T): void {
    if (this.services.has(name)) {
      console.warn(`[PluginRegistry] Service "${name}" is already registered, overwriting`);
    }
    this.services.set(name, service);
  }

  /**
   * Get a service registered by another plugin
   */
  getService<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  /**
   * Register a plugin
   */
  register(plugin: BuntimePlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Validate dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(
            `Plugin "${plugin.name}" requires "${dep}" which is not loaded. ` +
              `Make sure "${dep}" is listed before "${plugin.name}" in the plugins array.`,
          );
        }
      }
    }

    this.plugins.set(plugin.name, plugin);
    this.order.push(plugin.name);
  }

  /**
   * Get a plugin by name
   */
  get(name: string): BuntimePlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all plugins in registration order (topologically sorted by dependencies)
   */
  getAll(): BuntimePlugin[] {
    return this.order.map((name) => this.plugins.get(name)!);
  }

  /**
   * Check if a plugin is registered
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get number of registered plugins
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Run onRequest hooks in order
   * Returns modified request or response (for short-circuit)
   */
  async runOnRequest(req: Request, app?: AppInfo): Promise<Request | Response> {
    let currentReq = req;

    for (const plugin of this.getAll()) {
      if (!plugin.onRequest) continue;

      try {
        const result = await plugin.onRequest(currentReq, app);

        if (result instanceof Response) {
          // Short-circuit: plugin returned a response
          return result;
        }

        if (result instanceof Request) {
          // Plugin modified the request
          currentReq = result;
        }
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onRequest error:`, error);
        throw error;
      }
    }

    return currentReq;
  }

  /**
   * Run onResponse hooks in order
   * Returns modified response
   */
  async runOnResponse(res: Response, app: AppInfo): Promise<Response> {
    let currentRes = res;

    for (const plugin of this.getAll()) {
      if (!plugin.onResponse) continue;

      try {
        currentRes = await plugin.onResponse(currentRes, app);
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onResponse error:`, error);
        throw error;
      }
    }

    return currentRes;
  }

  /**
   * Run onWorkerSpawn hooks
   */
  runOnWorkerSpawn(worker: WorkerInstance, app: AppInfo): void {
    for (const plugin of this.getAll()) {
      if (!plugin.onWorkerSpawn) continue;

      try {
        plugin.onWorkerSpawn(worker, app);
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onWorkerSpawn error:`, error);
      }
    }
  }

  /**
   * Run onWorkerTerminate hooks
   */
  runOnWorkerTerminate(worker: WorkerInstance, app: AppInfo): void {
    for (const plugin of this.getAll()) {
      if (!plugin.onWorkerTerminate) continue;

      try {
        plugin.onWorkerTerminate(worker, app);
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onWorkerTerminate error:`, error);
      }
    }
  }

  /**
   * Run onServerStart hooks for all plugins
   */
  runOnServerStart(server: Server<unknown>): void {
    for (const plugin of this.getAll()) {
      if (!plugin.onServerStart) continue;

      try {
        plugin.onServerStart(server);
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onServerStart error:`, error);
      }
    }
  }

  /**
   * Get combined WebSocket handler from all plugins
   * Returns undefined if no plugins have WebSocket handlers
   */
  getWebSocketHandler() {
    const plugins = this.getAll().filter((p) => p.websocket);

    if (plugins.length === 0) {
      return undefined;
    }

    // If only one plugin has websocket, return it directly
    if (plugins.length === 1) {
      // Non-null assertion is safe here because we filtered for plugins with websocket
      return plugins[0]!.websocket!;
    }

    // Combine multiple websocket handlers
    return {
      open: (ws: ServerWebSocket<unknown>) => {
        for (const plugin of plugins) {
          plugin.websocket?.open?.(ws);
        }
      },
      message: (ws: ServerWebSocket<unknown>, message: string | Buffer) => {
        for (const plugin of plugins) {
          plugin.websocket?.message?.(ws, message);
        }
      },
      close: (ws: ServerWebSocket<unknown>, code: number, reason: string) => {
        for (const plugin of plugins) {
          plugin.websocket?.close?.(ws, code, reason);
        }
      },
    };
  }

  /**
   * Run onShutdown hooks for all plugins
   */
  async shutdown(): Promise<void> {
    // Run in reverse order (last loaded = first shutdown)
    const plugins = this.getAll().reverse();

    for (const plugin of plugins) {
      if (!plugin.onShutdown) continue;

      try {
        await plugin.onShutdown();
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onShutdown error:`, error);
      }
    }
  }

  /**
   * Store mounted plugin paths for conflict detection
   */
  setMountedPaths(paths: Map<string, string>): void {
    this.mountedPaths = paths;
  }

  /**
   * Get all mounted plugin paths
   */
  getMountedPaths(): Map<string, string> {
    return this.mountedPaths;
  }

  /**
   * Check if a path conflicts with a plugin route
   * Returns the plugin name if there's a conflict, undefined otherwise
   */
  checkRouteConflict(appPath: string): string | undefined {
    // Direct match
    if (this.mountedPaths.has(appPath)) {
      return this.mountedPaths.get(appPath);
    }

    // Check if app path starts with any plugin path
    for (const [pluginPath, pluginName] of this.mountedPaths) {
      if (appPath.startsWith(pluginPath + "/") || appPath === pluginPath) {
        return pluginName;
      }
      // Check if plugin path starts with app path (plugin is more specific)
      if (pluginPath.startsWith(appPath + "/") || pluginPath === appPath) {
        return pluginName;
      }
    }

    return undefined;
  }

  /**
   * Log warning if worker/app route conflicts with a plugin
   */
  warnIfRouteConflict(appName: string, appPath: string): void {
    const conflictingPlugin = this.checkRouteConflict(appPath);
    if (conflictingPlugin) {
      console.warn(
        `[Warning] App "${appName}" has route "${appPath}" which conflicts with plugin "${conflictingPlugin}". ` +
          `Plugin routes take priority and will handle requests to this path.`,
      );
    }
  }
}

/**
 * Create a logger for a plugin
 * Uses the global logger with plugin context
 */
export function createPluginLogger(pluginName: string): PluginLogger {
  const logger = getLogger().child(`plugin:${pluginName}`);

  return {
    debug: (message, meta) => logger.debug(message, meta as Record<string, unknown>),
    error: (message, meta) => logger.error(message, meta as Record<string, unknown>),
    info: (message, meta) => logger.info(message, meta as Record<string, unknown>),
    warn: (message, meta) => logger.warn(message, meta as Record<string, unknown>),
  };
}
