import { getLogger } from "@buntime/shared/logger";
import type {
  AppInfo,
  BuntimePlugin,
  PluginLogger,
  RouteHandler,
  WorkerInstance,
} from "@buntime/shared/types";
import type { Server, ServerWebSocket } from "bun";

/**
 * Registry for managing loaded plugins
 */
export class PluginRegistry {
  private logger = getLogger().child("PluginRegistry");
  private mountedPaths: Map<string, string> = new Map(); // path -> pluginName
  private order: string[] = [];
  private pluginDirs: Map<string, string> = new Map(); // pluginName -> directory
  private plugins: Map<string, BuntimePlugin> = new Map();
  private services: Map<string, unknown> = new Map(); // serviceName -> service

  /**
   * Get number of registered plugins
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Collect all plugin server.routes and wrap with auth check
   * Returns routes object for Bun.serve({ routes })
   */
  collectServerRoutes(): Record<string, RouteHandler> {
    const routes: Record<string, RouteHandler> = {};

    for (const plugin of this.getAll()) {
      if (!plugin.server?.routes) continue;

      for (const [path, handler] of Object.entries(plugin.server.routes)) {
        // Wrap handler with auth check via onRequest hooks
        // Security: If auth check fails/throws, deny access by default
        routes[path] = async (req: Request): Promise<Response> => {
          try {
            const result = await this.runOnRequest(req);
            if (result instanceof Response) {
              return result; // Auth failed or plugin responded
            }

            // All plugins passed, call original handler
            if (typeof handler === "function") {
              return handler(result) as Promise<Response>;
            }
            return handler as Response;
          } catch (error) {
            // Security: Auth check failure = deny access
            this.logger.error(`Auth check failed for ${path}`, { error });
            return new Response("Unauthorized", { status: 401 });
          }
        };
      }
    }

    return routes;
  }

  /**
   * Clear all registered plugins and services
   * Used when rescanning plugins
   */
  clear(): void {
    this.plugins.clear();
    this.pluginDirs.clear();
    this.order = [];
    this.services.clear();
    this.mountedPaths.clear();
    this.logger.debug("Registry cleared");
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
    // Safe: order only contains names that were registered via register()
    return this.order.map((name) => this.plugins.get(name)).filter(Boolean) as BuntimePlugin[];
  }

  /**
   * Get all mounted plugin paths
   */
  getMountedPaths(): Map<string, string> {
    return this.mountedPaths;
  }

  /**
   * Get all plugin base paths for app-shell routing
   * Used to determine which paths should be intercepted by the shell
   */
  getPluginBasePaths(): Set<string> {
    const bases = new Set<string>();
    for (const plugin of this.getAll()) {
      bases.add(plugin.base);
    }
    return bases;
  }

  /**
   * Get the directory of a plugin
   */
  getPluginDir(name: string): string | undefined {
    return this.pluginDirs.get(name);
  }

  /**
   * Get all plugins that have server.fetch handlers
   */
  getPluginsWithServerFetch(): BuntimePlugin[] {
    return this.getAll().filter((p) => p.server?.fetch);
  }

  /**
   * Get a service registered by another plugin
   */
  getService<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
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
   * Check if a plugin is registered
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Register a plugin with its directory
   * @param plugin The plugin to register
   * @param dir The plugin's directory (for spawning as worker)
   */
  register(plugin: BuntimePlugin, dir?: string): void {
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
    if (dir) {
      this.pluginDirs.set(plugin.name, dir);
    }
    this.order.push(plugin.name);
  }

  /**
   * Register a service for other plugins to use
   */
  registerService<T>(name: string, service: T): void {
    if (this.services.has(name)) {
      this.logger.warn(`Service "${name}" is being overwritten`);
    }
    this.services.set(name, service);
  }

  /**
   * Resolve a plugin app by pathname
   * Returns the plugin directory and base path if the plugin is a worker app
   *
   * All plugins with a directory are workers (structure: server/, client/, plugin.ts, index.ts)
   * - API routes: /{base}/api/*
   * - Fragment UI (if has fragment): /{base}/
   * - Standalone access: /{base}/ (without shell)
   */
  resolvePluginApp(pathname: string): { dir: string; basePath: string } | undefined {
    // Check each plugin with a directory (directory = is a worker app)
    for (const plugin of this.getAll()) {
      const dir = this.pluginDirs.get(plugin.name);
      if (!dir) continue;

      // Check if pathname matches this plugin's base path
      if (pathname === plugin.base || pathname.startsWith(`${plugin.base}/`)) {
        return { dir, basePath: plugin.base };
      }
    }

    return undefined;
  }

  /**
   * Run onRequest hooks in order
   * Returns modified request or response (for short-circuit)
   *
   * @param req - The incoming request
   * @param app - Optional app info (includes config.publicRoutes)
   */
  async runOnRequest(req: Request, app?: AppInfo): Promise<Request | Response> {
    let currentReq = req;

    for (const plugin of this.getAll()) {
      if (!plugin.onRequest) continue;

      try {
        const result = await plugin.onRequest(currentReq, app);

        if (result instanceof Response) {
          return result; // Short-circuit: plugin returned a response
        }

        if (result instanceof Request) {
          currentReq = result; // Plugin modified the request
        }
      } catch (error) {
        this.logger.error(`[${plugin.name}] onRequest error`, { error });
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
        this.logger.error(`[${plugin.name}] onResponse error`, { error });
        throw error;
      }
    }

    return currentRes;
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
        this.logger.error(`[${plugin.name}] onServerStart error`, { error });
      }
    }
  }

  /**
   * Run onShutdown hooks for all plugins
   */
  async runOnShutdown(): Promise<void> {
    // Run in reverse order (last loaded = first shutdown)
    const plugins = this.getAll().reverse();

    for (const plugin of plugins) {
      if (!plugin.onShutdown) continue;

      try {
        await plugin.onShutdown();
      } catch (error) {
        this.logger.error(`[${plugin.name}] onShutdown error`, { error });
      }
    }
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
        this.logger.error(`[${plugin.name}] onWorkerSpawn error`, { error });
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
        this.logger.error(`[${plugin.name}] onWorkerTerminate error`, { error });
      }
    }
  }

  /**
   * Store mounted plugin paths for conflict detection
   */
  setMountedPaths(paths: Map<string, string>): void {
    this.mountedPaths = paths;
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
