import { NotFoundError } from "@buntime/shared/errors";
import type { HomepageConfig } from "@buntime/shared/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { RESERVED_PATHS } from "@/constants";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";
import { createWorkerRequest } from "@/utils/request";

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
  getWorkerDir: (appName: string) => string;
  pool: WorkerPool;
  registry?: PluginRegistry;
}

export function createWorkerRoutes({ config, getWorkerDir, pool, registry }: WorkerRoutesDeps) {
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

    const workerConfig = await loadWorkerConfig(pluginApp.dir);

    // Calculate pathname relative to plugin app base path
    const originalUrl = new URL(ctx.req.url);
    // Use requestPath for rewriting since it may be overridden (e.g., homepage)
    const tempUrl = new URL(requestPath, originalUrl.href);
    const relativePath = tempUrl.pathname.slice(pluginApp.basePath.length) || "/";

    const req = createWorkerRequest({
      base: overrideBase ?? pluginApp.basePath,
      originalRequest: ctx.req.raw,
      targetPath: relativePath,
    });

    return pool.fetch(pluginApp.dir, workerConfig, req);
  }

  /**
   * Handle app (traditional worker)
   */
  async function runApp(ctx: Context, app: string) {
    const dir = getWorkerDir(app);
    if (!dir) throw new NotFoundError(`App not found: ${app}`, "APP_NOT_FOUND");

    const workerConfig = await loadWorkerConfig(dir);
    const originalUrl = new URL(ctx.req.url);
    const relativePath = originalUrl.pathname.slice(`/${app}`.length) || "/";

    const req = createWorkerRequest({
      base: `/${app}`,
      originalRequest: ctx.req.raw,
      targetPath: relativePath,
    });

    return pool.fetch(dir, workerConfig, req);
  }

  /**
   * Main request handler - checks plugin apps first, then apps
   */
  async function run(ctx: Context, app: string) {
    // 0. Skip reserved paths (e.g., .well-known, .git, api, health)
    if (app.startsWith(".") || RESERVED_PATHS.includes(`/${app}`)) {
      return new Response("Not Found", { status: 404 });
    }

    // 1. Check if this is a plugin app
    const pluginResponse = await runPluginApp(ctx);
    if (pluginResponse) return pluginResponse;

    // 2. Fallback to app
    return runApp(ctx, app);
  }

  /**
   * Handle homepage request
   * - string: redirects to the path
   * - object with base: serves app inline with custom base path
   */
  async function runHomepage(ctx: Context) {
    if (!config.homepage) {
      return new Response(`Buntime v${config.version}`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Simple string config: redirect to the path
    if (typeof config.homepage === "string") {
      if (config.homepage.startsWith("/")) {
        return ctx.redirect(config.homepage);
      }
      // App name - redirect to /:app
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
      throw new NotFoundError(`Homepage plugin not found: ${app}`, "HOMEPAGE_PLUGIN_NOT_FOUND");
    }

    // App name
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
