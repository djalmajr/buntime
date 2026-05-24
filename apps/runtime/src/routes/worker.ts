import { NotFoundError } from "@buntime/shared/errors";
import type { Context } from "hono";
import { Hono } from "hono";
import { RESERVED_PATHS } from "@/constants";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";
import { type ParsedAppPath, parseAppPath } from "@/utils/app-path";
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
   * Handle app (traditional or namespaced worker). `parsed` carries the
   * resolved name (`app` or `@scope/app`), its base path, and the remaining
   * path relative to that base.
   */
  async function runApp(ctx: Context, parsed: ParsedAppPath) {
    const dir = getWorkerDir(parsed.name);
    if (!dir) throw new NotFoundError(`App not found: ${parsed.name}`, "APP_NOT_FOUND");

    const workerConfig = await loadWorkerConfig(dir);

    const req = createWorkerRequest({
      base: parsed.basePath,
      originalRequest: ctx.req.raw,
      targetPath: parsed.rest,
    });

    return pool.fetch(dir, workerConfig, req);
  }

  /**
   * Main request handler - checks plugin apps first, then apps
   */
  async function run(ctx: Context, parsed: ParsedAppPath) {
    // 0. Skip reserved paths (e.g., .well-known, .git, api, health). The guard
    // applies to the FIRST segment; namespaced names (`@scope/...`) never
    // collide with reserved single-segment paths.
    const firstSegment = parsed.name.split("/")[0]!;
    if (firstSegment.startsWith(".") || RESERVED_PATHS.includes(`/${firstSegment}`)) {
      return new Response("Not Found", { status: 404 });
    }

    // 1. Check if this is a plugin app
    const pluginResponse = await runPluginApp(ctx);
    if (pluginResponse) return pluginResponse;

    // 2. Fallback to app
    return runApp(ctx, parsed);
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
   * Catch-all: parse the app key (single- or two-segment namespaced name) and
   * route. Root (`/`) returns version info.
   */
  async function handleAppRoute(ctx: Context) {
    const parsed = parseAppPath(ctx.req.path);
    if (!parsed) return handleRoot(ctx);
    return run(ctx, parsed);
  }

  return new Hono().all("/*", handleAppRoute);
}
