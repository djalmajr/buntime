import { errorToResponse } from "@buntime/shared/errors";
import { getChildLogger } from "@buntime/shared/logger";
import type {
  AppInfo,
  HomepageConfig,
  WorkerConfig as SharedWorkerConfig,
} from "@buntime/shared/types";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import { APP_NAME_PATTERN, Headers } from "@/constants";
import type { WorkerConfig } from "@/libs/pool/config";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";
import {
  BodyTooLargeError,
  cloneRequestBody,
  createWorkerRequest,
  rewriteUrl,
} from "@/utils/request";

const logger = getChildLogger("App");

export interface AppDeps {
  /** Apps core routes for /api/core/apps */
  appsCore: Hono;
  /** Config core routes for /api/core/config */
  configCore: Hono;
  getWorkerDir: (appName: string) => string | undefined;
  /**
   * Homepage configuration from HOMEPAGE_APP env var
   * String: redirect to path (e.g., "/my-app")
   * Object: app-shell mode (e.g., { app: "cpanel", shell: true })
   */
  homepage?: string | HomepageConfig;
  /** Plugins core routes for /api/core/plugins */
  pluginsCore: Hono;
  pluginsInfo: Hono;
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
  // Router basepath is handled client-side via fragment-outlet's base attribute
  const newReq = createWorkerRequest({
    base: resolved.basePath,
    originalRequest: req,
    targetPath: pathname,
  });

  return pool.fetch(resolved.dir, resolved.config, newReq, preReadBody);
}

/**
 * Resolved shell configuration
 */
interface ResolvedShell {
  name: string;
  base: string;
  dir: string;
  config: WorkerConfig;
}

/**
 * Resolve shell worker if homepage is configured for app-shell mode
 */
async function resolveShell(
  homepage: string | HomepageConfig | undefined,
  getWorkerDir: (appName: string) => string | undefined,
): Promise<ResolvedShell | undefined> {
  if (!homepage) return undefined;

  // String format is redirect mode, not shell mode
  if (typeof homepage === "string") return undefined;

  // Object format with shell: true enables app-shell mode
  if (!homepage.shell) return undefined;

  const dir = getWorkerDir(homepage.app);
  if (!dir) {
    logger.warn(`Shell worker "${homepage.app}" not found in workerDirs`);
    return undefined;
  }

  const config = await loadWorkerConfig(dir);

  return {
    name: homepage.app,
    base: `/${homepage.app}`,
    dir,
    config,
  };
}

/**
 * Check if a pathname should be routed to the shell
 * Returns true for navigation requests to:
 * - "/" (homepage)
 * - Any path starting with a plugin base (e.g., "/metrics", "/metrics/workers")
 *
 * Returns false for:
 * - Non-navigation requests (e.g., fetch from fragment-outlet)
 * - API routes (paths containing "/api/")
 *
 * Note: Public routes are checked separately before calling this function
 * to avoid redirect loops (e.g., /auth/login should not go through shell)
 */
function shouldRouteToShell(
  pathname: string,
  secFetchMode: string | undefined,
  pluginBases: Set<string>,
): boolean {
  // Only intercept top-level navigation (not fetch from fragment-outlet)
  if (secFetchMode && secFetchMode !== "navigate") return false;

  // Don't intercept API routes
  if (pathname.includes("/api/")) return false;

  // Homepage always goes to shell
  if (pathname === "/" || pathname === "") return true;

  // Check if pathname matches any plugin base
  return [...pluginBases].some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

interface ShellRequestParams {
  fragmentRoute: string;
  notFound?: boolean;
  req: Request;
  shell: ResolvedShell;
}

/**
 * Create a request for the shell app with proper headers
 * Handles URL rewriting and header injection for fragment routing
 */
function createShellRequest({
  fragmentRoute,
  notFound = false,
  req,
  shell,
}: ShellRequestParams): Request {
  // Shell always serves from root, so pathname is "/"
  // x-base must be the shell's actual base path so assets load correctly
  // e.g., shell at /cpanel -> <base href="/cpanel/"> -> /cpanel/index.js
  return createWorkerRequest({
    base: shell.base,
    fragmentRoute,
    notFound,
    originalRequest: req,
    targetPath: "/",
  });
}

/**
 * Context shared between routing handlers
 */
interface RoutingContext {
  appInfo?: AppInfo;
  appsCore: Hono;
  configCore: Hono;
  method: string;
  pathname: string;
  pluginsCore: Hono;
  pool: WorkerPool;
  processedReq: Request;
  registry: PluginRegistry;
  requestBody: ArrayBuffer | null;
  /** Correlation ID for request tracing */
  requestId: string;
  resolved?: ResolvedApp;
  shell?: ResolvedShell;
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
 * Handle /api/core/plugins route
 */
async function handlePluginsCoreRoute(ctx: RoutingContext): Promise<Response | null> {
  const prefix = "/api/core/plugins";
  if (ctx.pathname !== prefix && !ctx.pathname.startsWith(`${prefix}/`)) {
    return null;
  }

  const originalUrl = new URL(ctx.url);
  const newUrl = rewriteUrl(originalUrl, prefix);
  const req = createProcessedRequest(ctx, newUrl);
  return ctx.pluginsCore.fetch(req);
}

/**
 * Handle /api/core/apps route
 */
async function handleAppsCoreRoute(ctx: RoutingContext): Promise<Response | null> {
  const prefix = "/api/core/apps";
  if (ctx.pathname !== prefix && !ctx.pathname.startsWith(`${prefix}/`)) {
    return null;
  }

  const originalUrl = new URL(ctx.url);
  const newUrl = rewriteUrl(originalUrl, prefix);
  const req = createProcessedRequest(ctx, newUrl);
  return ctx.appsCore.fetch(req);
}

/**
 * Handle /api/core/config route
 */
async function handleConfigCoreRoute(ctx: RoutingContext): Promise<Response | null> {
  const prefix = "/api/core/config";
  if (ctx.pathname !== prefix && !ctx.pathname.startsWith(`${prefix}/`)) {
    return null;
  }

  const originalUrl = new URL(ctx.url);
  const newUrl = rewriteUrl(originalUrl, prefix);
  const req = createProcessedRequest(ctx, newUrl);
  return ctx.configCore.fetch(req);
}

/**
 * Handle /api/plugins route
 */
async function handlePluginsInfoRoute(
  ctx: RoutingContext,
  pluginsInfo: Hono,
): Promise<Response | null> {
  if (ctx.pathname !== "/api/plugins" && !ctx.pathname.startsWith("/api/plugins/")) {
    return null;
  }

  const originalUrl = new URL(ctx.url);
  const newUrl = rewriteUrl(originalUrl, "/api/plugins");
  const req = createProcessedRequest(ctx, newUrl);
  return pluginsInfo.fetch(req);
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
 * Handle 404 with shell (show consistent 404 page)
 */
async function handle404WithShell(ctx: RoutingContext, response: Response): Promise<Response> {
  if (response.status !== 404 || !ctx.shell || !ctx.pool) {
    return response;
  }

  const shellReq = createProcessedRequest(ctx);
  const shellRequest = createShellRequest({
    fragmentRoute: ctx.pathname,
    notFound: true,
    req: shellReq,
    shell: ctx.shell,
  });
  return ctx.pool.fetch(ctx.shell.dir, ctx.shell.config, shellRequest, ctx.requestBody);
}

/**
 * Create the main Hono app with unified routing
 */
export function createApp({
  appsCore,
  configCore,
  getWorkerDir,
  homepage,
  pluginsCore,
  pluginsInfo,
  pool,
  registry,
  workers,
}: AppDeps) {
  const app = new HonoApp();

  // Resolve shell worker early (will be used in routing)
  // Catch errors to prevent rejected promise from blocking all requests
  let shellPromise: Promise<ResolvedShell | undefined> | undefined;
  if (homepage && pool) {
    shellPromise = resolveShell(homepage, getWorkerDir).catch((err) => {
      logger.error("Failed to resolve shell worker", { error: err });
      return undefined; // Graceful degradation
    });
  }

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
    const method = honoCtx.req.method;

    // Generate or use existing correlation ID for request tracing
    const requestId = honoCtx.req.header(Headers.REQUEST_ID) ?? crypto.randomUUID();

    // Security: CSRF protection for state-changing requests
    // Validates Origin header matches the request Host
    const isStateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (isStateChanging) {
      const origin = honoCtx.req.header("origin");
      const host = honoCtx.req.header("host");

      // Security: Require Origin header for state-changing requests from browsers
      // Missing Origin on state-changing requests is suspicious (potential CSRF)
      // Exception: Allow internal requests (worker-to-runtime) marked with X-Buntime-Internal
      const isInternal = honoCtx.req.header(Headers.INTERNAL) === "true";
      if (!origin && !isInternal) {
        logger.warn("Missing Origin on state-changing request", { method, pathname, requestId });
        return new Response("Forbidden - Origin required", { status: 403 });
      }

      // If Origin is present, it must match the Host
      // Security: Validate origin safely to prevent URL parsing attacks
      if (origin && host) {
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
    }

    const shell = shellPromise ? await shellPromise : undefined;
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

    // APP-SHELL MODE: Intercept navigation requests to shell
    // Get plugin bases dynamically to support hot-reload
    const pluginBases = registry.getPluginBasePaths();
    const secFetchMode = honoCtx.req.header(Headers.SEC_FETCH_MODE);
    if (shell && pool && shouldRouteToShell(pathname, secFetchMode, pluginBases)) {
      const hookResult = await registry.runOnRequest(honoCtx.req.raw, appInfo);
      if (hookResult instanceof Response) return hookResult;

      const shellHeaders = new globalThis.Headers(hookResult.headers);
      shellHeaders.set(Headers.REQUEST_ID, requestId);
      const shellReq = new Request(honoCtx.req.url, {
        body: requestBody,
        headers: shellHeaders,
        method: honoCtx.req.method,
      });
      const shellRequest = createShellRequest({ fragmentRoute: pathname, req: shellReq, shell });
      const response = await pool.fetch(shell.dir, shell.config, shellRequest, requestBody);
      return runOnResponse(response);
    }

    // Run plugin onRequest hooks (auth, etc.)
    const processedReq = await registry.runOnRequest(honoCtx.req.raw, appInfo);
    if (processedReq instanceof Response) return processedReq;

    // Build routing context
    const ctx: RoutingContext = {
      appInfo,
      appsCore,
      configCore,
      method: honoCtx.req.method,
      pathname,
      pluginsCore,
      pool,
      processedReq,
      registry,
      requestBody,
      requestId,
      resolved,
      shell,
      url: honoCtx.req.url,
    };

    // Route through handlers in priority order
    // Core APIs first (always available, solves bootstrap problem)
    const pluginsCoreResponse = await handlePluginsCoreRoute(ctx);
    if (pluginsCoreResponse) return runOnResponse(pluginsCoreResponse);

    const appsCoreResponse = await handleAppsCoreRoute(ctx);
    if (appsCoreResponse) return runOnResponse(appsCoreResponse);

    const configCoreResponse = await handleConfigCoreRoute(ctx);
    if (configCoreResponse) return runOnResponse(configCoreResponse);

    const pluginsInfoResponse = await handlePluginsInfoRoute(ctx, pluginsInfo);
    if (pluginsInfoResponse) return runOnResponse(pluginsInfoResponse);

    const serverFetchResponse = await handlePluginServerFetch(ctx);
    if (serverFetchResponse) return runOnResponse(serverFetchResponse);

    const pluginRoutesResponse = await handlePluginRoutes(ctx);
    if (pluginRoutesResponse) return runOnResponse(pluginRoutesResponse);

    const pluginAppResponse = await handlePluginApp(ctx);
    if (pluginAppResponse) return runOnResponse(pluginAppResponse);

    // Fall back to worker routes
    const workerReq = createProcessedRequest(ctx);
    const response = await workers.fetch(workerReq);

    // Handle 404 with shell if available
    const finalResponse = await handle404WithShell(ctx, response);
    return runOnResponse(finalResponse);
  });

  app.onError(errorToResponse);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
