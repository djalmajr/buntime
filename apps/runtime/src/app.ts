import { errorToResponse } from "@buntime/shared/errors";
import { getChildLogger } from "@buntime/shared/logger";
import type { AppInfo, WorkerManifest } from "@buntime/shared/types";
import type { WorkerConfig } from "@buntime/shared/utils/worker-config";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import { API_PATH, APP_NAME_PATTERN, Headers } from "@/constants";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";
import { createWellKnownRoutes } from "@/routes/well-known";
import {
  BodyTooLargeError,
  cloneRequestBody,
  createWorkerRequest,
  rewriteUrl,
} from "@/utils/request";

const logger = getChildLogger("App");

export interface AppDeps {
  /** API routes mounted at /api/* */
  coreRoutes: Hono;
  getWorkerDir: (appName: string) => string | undefined;
  pool: WorkerPool;
  registry: PluginRegistry;
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
  registry: PluginRegistry,
  getWorkerDir: (appName: string) => string | undefined,
): Promise<ResolvedApp | undefined> {
  // 1. Check plugin apps first
  const pluginApp = registry.resolvePluginApp(pathname);
  if (pluginApp) {
    const workerConfig = await loadWorkerConfig(pluginApp.dir);
    return {
      basePath: pluginApp.basePath,
      config: workerConfig,
      dir: pluginApp.dir,
      name: pluginApp.basePath.replace(/^\//, "") || "root",
      type: "plugin",
    };
  }

  // 2. Check regular worker apps (pattern: /:app/*)
  const match = pathname.match(APP_NAME_PATTERN);
  if (match?.[1]) {
    const appName = match[1];
    const dir = getWorkerDir(appName);
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
 * Load version from package.json
 * Returns "0.0.0" if package.json doesn't exist or has no version
 */
async function getAppVersion(dir: string): Promise<string> {
  try {
    const pkg = await Bun.file(`${dir}/package.json`).json();
    return pkg.version ?? "0.0.0";
  } catch (err) {
    logger.debug(`Could not read version from ${dir}/package.json`, { error: err });
    return "0.0.0";
  }
}

/**
 * Create AppInfo from resolved app for plugin hooks
 * Converts pool's WorkerConfig to shared WorkerConfig format
 */
async function createAppInfo(resolved: ResolvedApp): Promise<AppInfo> {
  const poolConfig = resolved.config;

  // Convert pool config (ms) to manifest format (seconds) for AppInfo
  const sharedConfig: WorkerManifest = {
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
    version: await getAppVersion(resolved.dir),
  };
}

/**
 * Serve a plugin app via the worker pool
 */
async function servePluginApp(
  req: Request,
  pool: WorkerPool,
  resolved: ResolvedApp,
  preReadBody?: ArrayBuffer | null,
): Promise<Response> {
  // Calculate pathname relative to plugin app base path
  const url = new URL(req.url);
  const pathname = url.pathname.slice(resolved.basePath.length) || "/";

  // x-base is always the plugin's basePath where assets are served
  const newReq = createWorkerRequest({
    base: resolved.basePath,
    originalRequest: req,
    targetPath: pathname,
  });

  return pool.fetch(resolved.dir, resolved.config, newReq, preReadBody);
}

/**
 * Context shared between routing handlers
 */
interface RoutingContext {
  appInfo?: AppInfo;
  method: string;
  pathname: string;
  pool: WorkerPool;
  processedReq: Request;
  registry: PluginRegistry;
  requestBody: ArrayBuffer | null;
  /** Correlation ID for request tracing */
  requestId: string;
  resolved?: ResolvedApp;
  url: string;
}

/**
 * Create a new request with processed headers, cloned body, and correlation ID
 */
function createProcessedRequest(ctx: RoutingContext, newUrl?: URL): Request {
  const headers = new globalThis.Headers(ctx.processedReq.headers);
  headers.set(Headers.REQUEST_ID, ctx.requestId);

  return new Request(newUrl?.href ?? ctx.url, {
    body: ctx.requestBody,
    headers,
    method: ctx.method,
  });
}

/**
 * Try plugin server.fetch handlers
 */
async function handlePluginServerFetch(ctx: RoutingContext): Promise<Response | null> {
  for (const plugin of ctx.registry.getPluginsWithServerFetch()) {
    const response = await plugin.server!.fetch!(ctx.processedReq);
    if (response.status !== 404) {
      return response;
    }
  }
  return null;
}

/**
 * Try plugin routes (in order of specificity - longest base first)
 * Queries registry dynamically to support hot-reload of plugins
 */
async function handlePluginRoutes(ctx: RoutingContext): Promise<Response | null> {
  // Get plugins with routes, sorted by base path length (longest first)
  const pluginsWithRoutes = ctx.registry
    .getAll()
    .filter((p) => p.routes)
    .sort((a, b) => b.base.length - a.base.length);

  for (const plugin of pluginsWithRoutes) {
    const base = plugin.base;
    if (base === "" || ctx.pathname === base || ctx.pathname.startsWith(`${base}/`)) {
      const originalUrl = new URL(ctx.url);
      const newUrl = rewriteUrl(originalUrl, base);
      const req = createProcessedRequest(ctx, newUrl);
      const response = await plugin.routes!.fetch(req);

      if (response.status !== 404) {
        return response;
      }
    }
  }
  return null;
}

/**
 * Serve plugin app (fragment) via worker pool
 */
async function handlePluginApp(ctx: RoutingContext): Promise<Response | null> {
  if (ctx.resolved?.type !== "plugin" || !ctx.pool) {
    return null;
  }

  const req = createProcessedRequest(ctx);
  return servePluginApp(req, ctx.pool, ctx.resolved, ctx.requestBody);
}

/**
 * Validate CSRF for state-changing requests
 * Returns Response if blocked, undefined if allowed
 */
function validateCsrf(
  method: string,
  pathname: string,
  requestId: string,
  origin: string | undefined,
  host: string | undefined,
  isInternal: boolean,
): Response | undefined {
  // Only check state-changing requests
  const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!isStateChanging) return undefined;

  // Allow internal requests (worker-to-runtime) marked with X-Buntime-Internal
  if (isInternal) return undefined;

  // Require Origin header for state-changing requests from browsers
  if (!origin) {
    logger.warn("Missing Origin on state-changing request", { method, pathname, requestId });
    return new Response("Forbidden - Origin required", { status: 403 });
  }

  // If Origin is present, validate it
  if (host) {
    try {
      const url = new URL(origin);
      // Block malformed URLs with credentials (user:pass@host format)
      if (url.username || url.password) {
        logger.warn("CSRF blocked: Origin contains credentials", {
          method,
          origin,
          pathname,
          requestId,
        });
        return new Response("Forbidden", { status: 403 });
      }
      // Validate protocol and host match
      if (!["http:", "https:"].includes(url.protocol) || url.host !== host) {
        logger.warn("CSRF validation failed", { host, method, origin, pathname, requestId });
        return new Response("Forbidden", { status: 403 });
      }
    } catch {
      logger.warn("CSRF blocked: Invalid Origin URL", { method, origin, pathname, requestId });
      return new Response("Forbidden", { status: 403 });
    }
  }

  return undefined;
}

/**
 * Create the main Hono app with unified routing
 */
export function createApp({ coreRoutes, getWorkerDir, pool, registry, workers }: AppDeps) {
  const app = new HonoApp();

  // Middleware for API routes - CSRF protection
  app.use(`${API_PATH}/*`, async (c, next) => {
    const requestId = c.req.header(Headers.REQUEST_ID) ?? crypto.randomUUID();
    const csrfResponse = validateCsrf(
      c.req.method,
      c.req.path,
      requestId,
      c.req.header("origin"),
      c.req.header("host"),
      c.req.header(Headers.INTERNAL) === "true",
    );
    if (csrfResponse) return csrfResponse;

    await next();
    c.header(Headers.REQUEST_ID, requestId);
  });

  // Mount API routes
  app.route(API_PATH, coreRoutes);

  // Mount well-known routes for service discovery
  app.route("/.well-known", createWellKnownRoutes());

  // Register initial plugin routes and check for collisions
  const pluginPaths = new Map<string, string>();
  for (const plugin of registry.getAll()) {
    if (plugin.routes) {
      const base = plugin.base;
      if (pluginPaths.has(base)) {
        const existingPlugin = pluginPaths.get(base);
        throw new Error(
          `Route collision: Plugin "${plugin.name}" cannot mount routes at "${base}" - ` +
            `already used by "${existingPlugin}"`,
        );
      }
      pluginPaths.set(base, plugin.name);
      logger.info(`Plugin "${plugin.name}" routes registered at ${base || "/"}`);
    }
  }
  registry.setMountedPaths(pluginPaths);

  // Main request handler
  app.all("*", async (honoCtx) => {
    const pathname = honoCtx.req.path;

    // Generate or use existing correlation ID for request tracing
    const requestId = honoCtx.req.header(Headers.REQUEST_ID) ?? crypto.randomUUID();

    const resolved = await resolveTargetApp(pathname, registry, getWorkerDir);
    const appInfo = resolved ? await createAppInfo(resolved) : undefined;

    // Security: Check body size limit (prevents DoS via large uploads)
    // Use worker-specific limit if available, otherwise default
    const maxBodySize = resolved?.config.maxBodySizeBytes;
    let requestBody: ArrayBuffer | null;
    try {
      requestBody = await cloneRequestBody(honoCtx.req.raw, maxBodySize);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return new Response("Payload Too Large", {
          headers: { [Headers.REQUEST_ID]: requestId },
          status: 413,
        });
      }
      throw err;
    }

    // Helper to run onResponse hooks and add correlation ID
    const runOnResponse = async (response: Response): Promise<Response> => {
      const processed = appInfo ? await registry.runOnResponse(response, appInfo) : response;
      // Add correlation ID to response headers
      const headers = new globalThis.Headers(processed.headers);
      headers.set(Headers.REQUEST_ID, requestId);
      return new Response(processed.body, {
        headers,
        status: processed.status,
        statusText: processed.statusText,
      });
    };

    // Run plugin onRequest hooks (auth, etc.)
    const processedReq = await registry.runOnRequest(honoCtx.req.raw, appInfo);
    if (processedReq instanceof Response) return processedReq;

    // Build routing context
    const ctx: RoutingContext = {
      appInfo,
      method: honoCtx.req.method,
      pathname,
      pool,
      processedReq,
      registry,
      requestBody,
      requestId,
      resolved,
      url: honoCtx.req.url,
    };

    // API routes (/api/*) are handled by mounted coreRoutes above
    // Route through other handlers in priority order

    const serverFetchResponse = await handlePluginServerFetch(ctx);
    if (serverFetchResponse) return runOnResponse(serverFetchResponse);

    const pluginRoutesResponse = await handlePluginRoutes(ctx);
    if (pluginRoutesResponse) return runOnResponse(pluginRoutesResponse);

    const pluginAppResponse = await handlePluginApp(ctx);
    if (pluginAppResponse) return runOnResponse(pluginAppResponse);

    // Fall back to worker routes
    const workerReq = createProcessedRequest(ctx);
    const response = await workers.fetch(workerReq);

    return runOnResponse(response);
  });

  app.onError(errorToResponse);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
