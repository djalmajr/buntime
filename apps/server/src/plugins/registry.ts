import type { AppInfo, BuntimePlugin, PluginLogger } from "@buntime/shared/types";
import type { Server, ServerWebSocket } from "bun";

/**
 * Registry for managing loaded plugins
 */
export class PluginRegistry {
  private plugins: Map<string, BuntimePlugin> = new Map();
  private order: string[] = [];

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
   * Get all plugins in registration order
   */
  getAll(): BuntimePlugin[] {
    return this.order.map((name) => this.plugins.get(name)!);
  }

  /**
   * Get all plugins sorted by priority (lower = earlier)
   */
  getAllSorted(): BuntimePlugin[] {
    return this.getAll().sort((a, b) => {
      const priorityA = a.priority ?? Infinity;
      const priorityB = b.priority ?? Infinity;
      return priorityA - priorityB;
    });
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
  async runOnRequest(req: Request, app: AppInfo): Promise<Request | Response> {
    let currentReq = req;

    for (const plugin of this.getAllSorted()) {
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

    for (const plugin of this.getAllSorted()) {
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
  runOnWorkerSpawn(worker: { id: string }, app: AppInfo): void {
    for (const plugin of this.getAllSorted()) {
      if (!plugin.onWorkerSpawn) continue;

      try {
        plugin.onWorkerSpawn(worker as any, app);
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onWorkerSpawn error:`, error);
      }
    }
  }

  /**
   * Run onWorkerTerminate hooks
   */
  runOnWorkerTerminate(worker: { id: string }, app: AppInfo): void {
    for (const plugin of this.getAllSorted()) {
      if (!plugin.onWorkerTerminate) continue;

      try {
        plugin.onWorkerTerminate(worker as any, app);
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onWorkerTerminate error:`, error);
      }
    }
  }

  /**
   * Run onServerStart hooks for all plugins
   */
  runOnServerStart(server: Server<unknown>): void {
    for (const plugin of this.getAllSorted()) {
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
    const plugins = this.getAllSorted().filter((p) => p.websocket);

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
    const plugins = this.getAllSorted().reverse();

    for (const plugin of plugins) {
      if (!plugin.onShutdown) continue;

      try {
        await plugin.onShutdown();
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] onShutdown error:`, error);
      }
    }
  }
}

/**
 * Create a logger for a plugin
 */
export function createPluginLogger(pluginName: string): PluginLogger {
  const prefix = `[Plugin:${pluginName}]`;

  return {
    debug: (message, ...args) => console.debug(prefix, message, ...args),
    error: (message, ...args) => console.error(prefix, message, ...args),
    info: (message, ...args) => console.info(prefix, message, ...args),
    warn: (message, ...args) => console.warn(prefix, message, ...args),
  };
}
