import type { Context } from "hono";
import { Hono } from "hono";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";

export interface HomepageConfig {
  /** Plugin or app path (e.g., "/cpanel" or "my-app") */
  app: string;
  /** Base path to inject. If omitted, redirects to app path instead of serving inline */
  base?: string;
}

export interface WorkerRoutesConfig {
  /**
   * Homepage configuration:
   * - string: redirects to the path (e.g., "/cpanel" → redirect to /cpanel)
   * - object: serves app at root with custom base (e.g., { app: "/cpanel", base: "/" })
   */
  homepage?: string | HomepageConfig;
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
   * @param ctx - Hono context
   * @param overridePath - Optional path to use instead of ctx.req.path (for homepage)
   * @param overrideBase - Optional base path override (e.g., "/" for homepage)
   */
  async function runPluginApp(ctx: Context, overridePath?: string, overrideBase?: string) {
    if (!registry) return null;

    const requestPath = overridePath || ctx.req.path;
    const pluginApp = registry.resolvePluginApp(requestPath);
    if (!pluginApp) return null;

    try {
      const workerConfig = await loadWorkerConfig(pluginApp.dir);
      const merged = { ...workerConfig, ...pluginApp.config };

      // Calculate pathname relative to plugin app base path
      const pathname = requestPath.slice(pluginApp.basePath.length) || "/";

      const req = new Request(new URL(pathname, ctx.req.url).href, ctx.req.raw);
      // Use override base if provided (for homepage), otherwise use plugin base path
      req.headers.set("x-base", overrideBase ?? pluginApp.basePath);

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
      const pathname = ctx.req.path.slice(`/${app}`.length) || "/";

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

  /**
   * Handle homepage request
   * - string: redirects to the path
   * - object with base: serves app inline with custom base path
   */
  async function runHomepage(ctx: Context) {
    if (!config.homepage) {
      return new Response(`Buntime v${config.version}`);
    }

    // Simple string config: redirect to the path
    if (typeof config.homepage === "string") {
      if (config.homepage.startsWith("/")) {
        return ctx.redirect(config.homepage);
      }
      // Workspace app name - redirect to /:app
      return ctx.redirect(`/${config.homepage}`);
    }

    // Object config: serve app with custom base
    const { app, base } = config.homepage;

    // No base specified: redirect instead of serving inline
    if (base === undefined) {
      return ctx.redirect(app.startsWith("/") ? app : `/${app}`);
    }

    // Plugin path (e.g., /cpanel)
    if (app.startsWith("/")) {
      // Build the full path: app base + current request path
      // e.g., /cpanel + /chunk-xxx.js = /cpanel/chunk-xxx.js
      const fullPath = ctx.req.path === "/" ? app : `${app}${ctx.req.path}`;

      const pluginResponse = await runPluginApp(ctx, fullPath, base);
      if (pluginResponse) return pluginResponse;
      return ctx.json({ error: `Homepage plugin not found: ${app}` }, 404);
    }

    // Workspace app name
    return runApp(ctx, app);
  }

  /**
   * Get normalized homepage config
   */
  function getHomepageConfig(): HomepageConfig | null {
    if (!config.homepage) return null;
    if (typeof config.homepage === "string") {
      return { app: config.homepage };
    }
    return config.homepage;
  }

  /**
   * Handle app routes - with homepage fallback for inline mode
   */
  async function handleAppRoute(ctx: Context) {
    // 1. Try normal app routing first
    const response = await run(ctx, ctx.req.param("app"));

    // 2. If app not found and homepage is inline, fallback to homepage
    if (response.status === 404) {
      const homepage = getHomepageConfig();
      if (homepage?.base !== undefined && homepage.app.startsWith("/")) {
        const fullPath = `${homepage.app}${ctx.req.path}`;
        const pluginResponse = await runPluginApp(ctx, fullPath, homepage.base);
        if (pluginResponse) return pluginResponse;
      }
    }

    return response;
  }

  return new Hono().all(":app/*", handleAppRoute).all("/*", runHomepage);
}
