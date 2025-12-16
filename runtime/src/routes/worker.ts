import type { Context } from "hono";
import { Hono } from "hono";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";

export interface WorkerRoutesConfig {
  homepage?: string;
  version: string;
}

export interface WorkerRoutesDeps {
  config: WorkerRoutesConfig;
  getAppDir: (appName: string) => string;
  pool: WorkerPool;
  registry?: PluginRegistry;
}

export function createWorkerRoutes({ config, getAppDir, pool, registry }: WorkerRoutesDeps) {
  /**
   * Handle plugin app (served as worker from plugin directory)
   */
  async function runPluginApp(ctx: Context) {
    if (!registry) return null;

    const pluginApp = registry.resolvePluginApp(ctx.req.path);
    if (!pluginApp) return null;

    try {
      const workerConfig = await loadWorkerConfig(pluginApp.dir);
      const merged = { ...workerConfig, ...pluginApp.config };

      // Calculate pathname relative to plugin app base path
      const pathname = ctx.req.path.slice(pluginApp.basePath.length) || "/";

      const req = new Request(new URL(pathname, ctx.req.url).href, ctx.req.raw);
      req.headers.set("x-base", pluginApp.basePath);

      return pool.fetch(pluginApp.dir, merged, req);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Main] Error serving plugin app at ${pluginApp.basePath}:`, error);
      return ctx.json({ error: `Error: ${error.message}` }, 500);
    }
  }

  /**
   * Handle workspace app (traditional worker)
   */
  async function runApp(ctx: Context, app: string) {
    try {
      const dir = getAppDir(app);
      if (!dir) return ctx.json({ error: `App not found: ${app}` }, 404);

      const workerConfig = await loadWorkerConfig(dir);
      const pathname = ctx.req.path.split(app)[1] || "/";

      const req = new Request(new URL(pathname, ctx.req.url).href, ctx.req.raw);
      req.headers.set("x-base", `/${app}`);

      return pool.fetch(dir, workerConfig, req);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Main] Error serving ${app}:`, error);
      return ctx.json({ error: `Error: ${error.message}` }, 500);
    }
  }

  /**
   * Main request handler - checks plugin apps first, then workspace apps
   */
  async function run(ctx: Context, app: string) {
    // 1. Check if this is a plugin app
    const pluginResponse = await runPluginApp(ctx);
    if (pluginResponse) return pluginResponse;

    // 2. Fallback to workspace app
    return runApp(ctx, app);
  }

  return new Hono()
    .all(":app/*", (ctx) => run(ctx, ctx.req.param("app")))
    .get("/*", (ctx) =>
      config.homepage ? run(ctx, config.homepage) : new Response(`Buntime v${config.version}`),
    );
}
