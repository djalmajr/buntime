import { getLogger } from "@buntime/shared/logger";
import type {
  AppInfo,
  BuntimePlugin,
  PluginLogger,
  RouteHandler,
  WorkerInstance,
} from "@buntime/shared/types";
import type { Server, ServerWebSocket } from "bun";
import { getPublicRoutesForMethod } from "@/utils/get-public-routes";
import { globArrayToRegex } from "@/utils/glob-to-regex";

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
   *
   * @param req - The incoming request
   * @param app - Optional app info (includes config.publicRoutes)
   */
  async runOnRequest(req: Request, app?: AppInfo): Promise<Request | Response> {
    let currentReq = req;
    const url = new URL(req.url);

    for (const plugin of this.getAll()) {
      if (!plugin.onRequest) continue;

      // Check if this route is public for this plugin
      if (this.isPublicRoute(plugin, url.pathname, req.method, app)) {
        continue; // Skip this plugin's onRequest
      }

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
   * Check if a route is public for a specific plugin
   * Checks both plugin's publicRoutes and worker's publicRoutes
   */
  private isPublicRoute(
    plugin: BuntimePlugin,
    pathname: string,
    method: string,
    app?: AppInfo,
  ): boolean {
    // 1. Check plugin's own publicRoutes (absolute paths)
    const pluginRoutes = getPublicRoutesForMethod(plugin.publicRoutes, method);
    if (pluginRoutes.length > 0) {
      const regex = globArrayToRegex(pluginRoutes);
      if (regex?.test(pathname)) return true;
    }

    // 2. Check worker's publicRoutes (relative to app basePath)
    if (app?.config?.publicRoutes && app.dir) {
      const workerRoutes = getPublicRoutesForMethod(app.config.publicRoutes, method);
      if (workerRoutes.length > 0) {
        // Get app base path from name (e.g., "todos-kv" → "/todos-kv")
        const basePath = `/${app.name}`;
        // Prefix worker routes with app basePath: /api/health → /todos-kv/api/health
        const absoluteRoutes = workerRoutes.map((route) => `${basePath}${route}`);
        const regex = globArrayToRegex(absoluteRoutes);
        if (regex?.test(pathname)) return true;
      }
    }

    return false;
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
   * Resolve a plugin app by pathname
   * Returns the app directory and config if found
   *
   * Checks both:
   * - Legacy `path` field (prefix matching)
   * - New `routes` field (glob pattern matching)
   */
  resolvePluginApp(
    pathname: string,
  ): { dir: string; basePath: string; config?: Record<string, unknown> } | undefined {
    for (const plugin of this.getAll()) {
      if (!plugin.apps) continue;

      for (const app of plugin.apps) {
        // Routes are absolute (no mountPath prefix)
        if (app.routes && app.routes.length > 0) {
          const regex = globArrayToRegex(app.routes);
          if (regex?.test(pathname)) {
            // basePath is the first route without glob (for relative pathname calculation)
            const basePath = app.routes[0]?.replace(/\/?\*+$/, "") || "";
            return { dir: app.dir, basePath, config: app.config };
          }
        }

        // path is also absolute
        if (app.path !== undefined) {
          if (pathname === app.path || pathname.startsWith(`${app.path}/`)) {
            return { dir: app.dir, basePath: app.path, config: app.config };
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Get all paths reserved by plugin apps
   */
  getReservedPaths(): Map<string, string> {
    const reserved = new Map<string, string>();

    for (const plugin of this.getAll()) {
      if (!plugin.apps) continue;

      for (const app of plugin.apps) {
        // Routes are absolute
        if (app.routes && app.routes.length > 0) {
          for (const route of app.routes) {
            // Remove glob patterns for reservation (just base path)
            const cleanRoute = route.replace(/\*+$/, "").replace(/\/+$/, "");
            reserved.set(cleanRoute, plugin.name);

            // Also reserve the first path segment for top-level conflicts
            const segments = cleanRoute.split("/").filter(Boolean);
            if (segments[0]) {
              reserved.set(`/${segments[0]}`, plugin.name);
            }
          }
        }

        // path is also absolute
        if (app.path !== undefined) {
          reserved.set(app.path, plugin.name);

          // Also reserve the first path segment for top-level conflicts
          const segments = app.path.split("/").filter(Boolean);
          if (segments[0]) {
            reserved.set(`/${segments[0]}`, plugin.name);
          }
        }
      }
    }

    return reserved;
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
      if (appPath.startsWith(`${pluginPath}/`) || appPath === pluginPath) {
        return pluginName;
      }
      // Check if plugin path starts with app path (plugin is more specific)
      if (pluginPath.startsWith(`${appPath}/`) || pluginPath === appPath) {
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

  /**
   * Check if a route is public for a specific plugin
   * Used by app.ts to check before calling server.fetch
   */
  isPublicRouteForPlugin(plugin: BuntimePlugin, pathname: string, method: string): boolean {
    const pluginRoutes = getPublicRoutesForMethod(plugin.publicRoutes, method);
    if (pluginRoutes.length === 0) return false;

    const regex = globArrayToRegex(pluginRoutes);
    return regex?.test(pathname) ?? false;
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
        routes[path] = this.wrapRouteWithAuth(path, handler, plugin);
      }
    }

    return routes;
  }

  /**
   * Wrap a route handler with auth check based on publicRoutes
   */
  private wrapRouteWithAuth(
    path: string,
    handler: RouteHandler,
    plugin: BuntimePlugin,
  ): RouteHandler {
    // Check if route matches any public route pattern
    // Note: path may contain wildcards like "/api/*", we check the base path
    const basePath = path.replace(/\/?\*+$/, "");

    // Check all HTTP methods - if public for any, return original handler
    // This is a simplification; for route-level we check against ALL and GET
    const allRoutes = getPublicRoutesForMethod(plugin.publicRoutes, "ALL");
    const getRoutes = getPublicRoutesForMethod(plugin.publicRoutes, "GET");
    const combinedRoutes = [...allRoutes, ...getRoutes];

    if (combinedRoutes.length > 0) {
      const regex = globArrayToRegex(combinedRoutes);
      if (regex?.test(basePath) || regex?.test(path)) {
        return handler;
      }
    }

    // Wrap with auth check - returns the handler result directly
    // Bun.serve handles BunFile and Response types internally
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const method = req.method;

      // Check if this specific request is public
      if (this.isPublicRouteForPlugin(plugin, url.pathname, method)) {
        if (typeof handler === "function") {
          return handler(req) as Promise<Response>;
        }
        // For static files (BunFile/Response), return as-is
        // Bun.serve will handle BunFile conversion internally
        return handler as Response;
      }

      // Run onRequest hooks (includes auth)
      const result = await this.runOnRequest(req);
      if (result instanceof Response) {
        return result; // Auth failed
      }

      // Auth passed, call original handler
      if (typeof handler === "function") {
        return handler(result) as Promise<Response>;
      }
      return handler as Response;
    };
  }

  /**
   * Get all plugins that have server.fetch handlers
   */
  getPluginsWithServerFetch(): BuntimePlugin[] {
    return this.getAll().filter((p) => p.server?.fetch);
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
