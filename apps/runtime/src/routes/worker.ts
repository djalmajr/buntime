import { NotFoundError } from "@buntime/shared/errors";
import type { Context } from "hono";
import { Hono } from "hono";
import { RESERVED_PATHS } from "@/constants";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";
import { createWorkerRequest } from "@/utils/request";

export interface WorkerRoutesConfig {
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
   * @param overridePath - Optional path to use instead of ctx.req.path (for shell routing)
   * @param overrideBase - Optional base path override (e.g., "/" for shell routing)
   */
  async function runPluginApp(ctx: Context, overridePath?: string, overrideBase?: string) {
    if (!registry) return null;

    const requestPath = overridePath || ctx.req.path;
    const pluginApp = registry.resolvePluginApp(requestPath);
    if (!pluginApp) return null;

    const workerConfig = await loadWorkerConfig(pluginApp.dir);

    // Calculate pathname relative to plugin app base path
    const originalUrl = new URL(ctx.req.url);
    // Use requestPath for rewriting since it may be overridden (e.g., shell routing)
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
   * Handle root request
   * Returns version info (shell routing is handled by plugin-gateway)
   */
  function handleRoot(_ctx: Context) {
    return new Response(`Buntime v${config.version}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  /**
   * Handle app routes
   */
  async function handleAppRoute(ctx: Context) {
    return run(ctx, ctx.req.param("app"));
  }

  return new Hono().all(":app/*", handleAppRoute).all("/*", handleRoot);
}
