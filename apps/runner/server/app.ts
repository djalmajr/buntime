import { errorToResponse } from "@buntime/shared/errors";
import type { AppInfo, WorkerConfig as SharedWorkerConfig } from "@buntime/shared/types";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import type { WorkerConfig } from "@/libs/pool/config";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";

/**
 * Get the default base path for a plugin
 * @example "@buntime/plugin-keyval" -> "/api/keyval"
 */
function getDefaultBase(pluginName: string): string {
  // Remove scope and "plugin-" prefix: @buntime/plugin-keyval -> keyval
  const shortName = pluginName.replace(/^@[^/]+\//, "").replace(/^plugin-/, "");
  return `/api/${shortName}`;
}

export interface AppDeps {
  getAppDir: (appName: string) => string | undefined;
  internal: Hono;
  pool?: WorkerPool;
  registry?: PluginRegistry;
  workers: Hono;
}

/**
 * Information about a resolved app target
 */
interface ResolvedApp {
  basePath: string;
  config: WorkerConfig;
  dir: string;
  name: string;
  type: "plugin" | "worker";
}

/**
 * Resolve which app will handle a request
 * Returns app info or undefined if no app matches
 */
async function resolveTargetApp(
  pathname: string,
  registry: PluginRegistry | undefined,
  getAppDir: (appName: string) => string | undefined,
): Promise<ResolvedApp | undefined> {
  // 1. Check plugin apps first
  if (registry) {
    const pluginApp = registry.resolvePluginApp(pathname);
    if (pluginApp) {
      const workerConfig = await loadWorkerConfig(pluginApp.dir);
      const merged = { ...workerConfig, ...pluginApp.config };
      return {
        basePath: pluginApp.basePath,
        config: merged,
        dir: pluginApp.dir,
        name: pluginApp.basePath.replace(/^\//, "") || "root",
        type: "plugin",
      };
    }
  }

  // 2. Check regular worker apps (pattern: /:app/*)
  const match = pathname.match(/^\/([^/]+)/);
  if (match?.[1]) {
    const appName = match[1];
    const dir = getAppDir(appName);
    if (dir) {
      const workerConfig = await loadWorkerConfig(dir);
      return {
        basePath: `/${appName}`,
        config: workerConfig,
        dir,
        name: appName,
        type: "worker",
      };
    }
  }

  return undefined;
}

/**
 * Create AppInfo from resolved app for plugin hooks
 * Converts pool's WorkerConfig to shared WorkerConfig format
 */
function createAppInfo(resolved: ResolvedApp): AppInfo {
  const poolConfig = resolved.config;

  // Convert pool config (ms) to shared config (seconds) format
  const sharedConfig: SharedWorkerConfig = {
    autoInstall: poolConfig.autoInstall,
    entrypoint: poolConfig.entrypoint,
    idleTimeout: poolConfig.idleTimeoutMs / 1000,
    lowMemory: poolConfig.lowMemory,
    maxRequests: poolConfig.maxRequests,
    publicRoutes: poolConfig.publicRoutes,
    timeout: poolConfig.timeoutMs / 1000,
    ttl: poolConfig.ttlMs / 1000,
  };

  return {
    config: sharedConfig,
    dir: resolved.dir,
    name: resolved.name,
    version: "1.0.0", // TODO: Get from worker config or manifest
  };
}

/**
 * Serve a plugin app via the worker pool
 */
async function servePluginApp(
  req: Request,
  pool: WorkerPool,
  resolved: ResolvedApp,
): Promise<Response> {
  // Calculate pathname relative to plugin app base path
  const url = new URL(req.url);
  const pathname = url.pathname.slice(resolved.basePath.length) || "/";

  const newReq = new Request(new URL(pathname + url.search, req.url).href, req);
  newReq.headers.set("x-base", resolved.basePath);

  return (await pool.getOrCreate(resolved.dir, resolved.config)).fetch(newReq);
}

/**
 * Create the main Hono app with unified routing
 */
export function createApp({ getAppDir, internal, pool, registry, workers }: AppDeps) {
  const app = new HonoApp();

  // Build plugin routes map: base -> { plugin, routes }
  type PluginType = NonNullable<typeof registry>["getAll"] extends () => (infer T)[] ? T : never;
  const pluginRoutes = new Map<string, { plugin: PluginType; routes: Hono }>();
  const pluginPaths = new Map<string, string>();

  if (registry) {
    for (const plugin of registry.getAll()) {
      const base = plugin.base ?? getDefaultBase(plugin.name);

      if (plugin.routes) {
        // Check plugin-vs-plugin collision
        if (pluginPaths.has(base)) {
          const existingPlugin = pluginPaths.get(base);
          throw new Error(
            `Route collision: Plugin "${plugin.name}" cannot mount routes at "${base}" - ` +
              `already used by "${existingPlugin}"`,
          );
        }

        pluginPaths.set(base, plugin.name);
        pluginRoutes.set(base, { plugin, routes: plugin.routes as Hono });
        console.log(`[Plugin] ${plugin.name} routes registered at ${base || "/"}`);
      }
    }

    registry.setMountedPaths(pluginPaths);
  }

  // Mount internal routes at /api
  app.route("/api", internal);

  // Single catch-all that handles: server.fetch -> onRequest -> plugin routes -> worker routes
  app.all("*", async (ctx) => {
    const pathname = ctx.req.path;
    const method = ctx.req.method;

    // 1. Try plugin server.fetch handlers (with publicRoutes check)
    if (registry) {
      for (const plugin of registry.getPluginsWithServerFetch()) {
        // Check if route is public for this plugin
        const isPublic = registry.isPublicRouteForPlugin(plugin, pathname, method);

        if (!isPublic) {
          // Protected route: run onRequest hooks first
          const result = await registry.runOnRequest(ctx.req.raw);
          if (result instanceof Response) {
            return result; // Auth failed
          }
        }

        // Call plugin's server.fetch
        try {
          const response = await plugin.server!.fetch!(ctx.req.raw);
          if (response.status !== 404) {
            return response;
          }
        } catch (err) {
          console.error(`[Plugin:${plugin.name}] server.fetch error:`, err);
        }
      }
    }

    // 2. Run plugin onRequest hooks for remaining routes
    if (registry) {
      const resolved = await resolveTargetApp(pathname, registry, getAppDir);
      const appInfo = resolved ? createAppInfo(resolved) : undefined;

      const result = await registry.runOnRequest(ctx.req.raw, appInfo);
      if (result instanceof Response) {
        return result;
      }

      // 3. Serve plugin app if resolved
      if (resolved?.type === "plugin" && pool) {
        try {
          return await servePluginApp(ctx.req.raw, pool, resolved);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(`[Main] Error serving plugin app at ${resolved.basePath}:`, error);
          return ctx.json({ error: `Error: ${error.message}` }, 500);
        }
      }
    }

    // 4. Try plugin routes (in order of specificity - longest base first)
    const sortedPaths = [...pluginRoutes.keys()].sort((a, b) => b.length - a.length);

    for (const base of sortedPaths) {
      // Check if pathname starts with base (or base is root)
      if (base === "" || pathname === base || pathname.startsWith(`${base}/`)) {
        const { routes } = pluginRoutes.get(base)!;

        // Rewrite URL to be relative to base, preserving query string
        const relativePath = base ? pathname.slice(base.length) || "/" : pathname;
        const originalUrl = new URL(ctx.req.url);
        const newUrl = new URL(relativePath + originalUrl.search, ctx.req.url);

        const newReq = new Request(newUrl.href, ctx.req.raw);
        const response = await routes.fetch(newReq);

        // If plugin route matched (not 404), return it
        if (response.status !== 404) {
          return response;
        }
      }
    }

    // 5. Fall back to worker routes
    return workers.fetch(ctx.req.raw);
  });

  // Error handler
  app.onError(errorToResponse);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
