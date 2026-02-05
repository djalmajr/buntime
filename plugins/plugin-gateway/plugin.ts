import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import { loadManifestConfig } from "@buntime/shared/utils/buntime-config";
import { parseWorkerConfig, type WorkerConfig } from "@buntime/shared/utils/worker-config";
import { createGatewayApi, type GatewayApiDeps } from "./server/api";
import { handlePreflight } from "./server/cors";
import {
  createPersistence,
  type GatewayPersistence,
  type KvLike,
  type MetricsSnapshot,
} from "./server/persistence";
import { parseWindow, RateLimiter } from "./server/rate-limit";
import { RequestLogger } from "./server/request-log";
import { parseBasenames, shouldBypassShell } from "./server/shell-bypass";
import type { GatewayConfig } from "./server/types";

// Type for the pool interface we need
interface PoolLike {
  fetch(
    appDir: string,
    config: WorkerConfig,
    req: Request,
    preReadBody?: ArrayBuffer | null,
  ): Promise<Response>;
}

// HTTP header constants
const HttpHeaders = {
  BASE: "x-base",
  NOT_FOUND: "x-not-found",
  SEC_FETCH_DEST: "sec-fetch-dest",
  SEC_FETCH_MODE: "sec-fetch-mode",
} as const;

/**
 * Resolved shell configuration
 */
interface ResolvedShell {
  dir: string;
  config: WorkerConfig;
}

// Module-level state
let rateLimiter: RateLimiter | null = null;
let requestLogger: RequestLogger;
let persistence: GatewayPersistence;
let config: GatewayConfig = {};
let rateLimitExcludePatterns: RegExp[] = [];
let logger: PluginContext["logger"];

// Micro-frontend shell state
let pool: PoolLike | null = null;
let shell: ResolvedShell | null = null;
let shellEnvExcludes: Set<string> = new Set();
let shellKeyValExcludes: Set<string> = new Set();

// Runtime API path (from context)
let apiPath: string = "/api";

// Note: onResponse doesn't receive original request, so we log in onRequest only
// This means we log rate-limited requests and shell requests, but not others

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function getRateLimitKey(
  req: Request,
  keyBy: NonNullable<GatewayConfig["rateLimit"]>["keyBy"],
): string {
  if (typeof keyBy === "function") {
    return keyBy(req);
  }

  if (keyBy === "user") {
    const identity = req.headers.get("X-Identity");
    if (identity) {
      try {
        const parsed = JSON.parse(identity);
        return `user:${parsed.sub}`;
      } catch {
        // Fall back to IP
      }
    }
  }

  return `ip:${getClientIp(req)}`;
}

function isExcluded(pathname: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(pathname));
}

/**
 * Create a metrics snapshot from current state
 */
function createMetricsSnapshot(): MetricsSnapshot {
  const metrics = rateLimiter?.getMetrics();
  return {
    timestamp: Date.now(),
    totalRequests: metrics?.totalRequests ?? 0,
    blockedRequests: metrics?.blockedRequests ?? 0,
    allowedRequests: metrics?.allowedRequests ?? 0,
    activeBuckets: metrics?.activeBuckets ?? 0,
  };
}

/**
 * Gateway plugin for Buntime
 *
 * Provides:
 * - Rate limiting (token bucket algorithm)
 * - CORS handling
 * - Micro-frontend shell
 * - Request logging
 * - Metrics persistence
 *
 * @example
 * ```yaml
 * # plugins/plugin-gateway/manifest.yaml
 * name: "@buntime/plugin-gateway"
 * base: /gateway
 * enabled: true
 * rateLimit:
 *   requests: 100
 *   window: 1m
 *   keyBy: ip
 * cors:
 *   origin: "*"
 *   credentials: false
 * ```
 */
export default function gatewayPlugin(pluginConfig: GatewayConfig = {}): PluginImpl {
  config = pluginConfig;

  // Initialize request logger (always available)
  requestLogger = new RequestLogger(100);

  // Initialize persistence (will connect to KeyVal in onInit)
  persistence = createPersistence();

  // Create API dependencies
  const apiDeps: GatewayApiDeps = {
    getConfig: () => config,
    getRateLimiter: () => rateLimiter,
    getResponseCache: () => null, // Cache disabled
    getRequestLogger: () => requestLogger,
    getPersistence: () => persistence,
    getShellConfig: () =>
      shell
        ? {
            dir: shell.dir,
            envExcludes: shellEnvExcludes,
            keyvalExcludes: shellKeyValExcludes,
            addKeyValExclude: (basename: string) => shellKeyValExcludes.add(basename),
            removeKeyValExclude: (basename: string) => shellKeyValExcludes.delete(basename),
          }
        : null,
    sseInterval: 1000,
  };

  const routes = createGatewayApi(apiDeps);

  return {
    async onInit(ctx: PluginContext) {
      logger = ctx.logger;
      apiPath = ctx.runtime.api;

      // Initialize rate limiter
      if (config.rateLimit) {
        const requests = config.rateLimit.requests ?? 100;
        const windowSeconds = parseWindow(config.rateLimit.window ?? "1m");

        rateLimiter = new RateLimiter(requests, windowSeconds);
        rateLimiter.startCleanup();

        rateLimitExcludePatterns = (config.rateLimit.excludePaths ?? []).map((p) => new RegExp(p));

        logger.info(`Rate limiting: ${requests} requests per ${config.rateLimit.window ?? "1m"}`);
      }

      // Log CORS config
      if (config.cors) {
        logger.info(`CORS enabled: origin=${JSON.stringify(config.cors.origin)}`);
      }

      // Initialize micro-frontend shell
      const shellPath = Bun.env.GATEWAY_SHELL_DIR || config.shellDir;
      if (shellPath && ctx.pool) {
        pool = ctx.pool as PoolLike;

        try {
          const manifestConfig = await loadManifestConfig(shellPath);
          const shellConfig = parseWorkerConfig(manifestConfig);

          shell = {
            dir: shellPath,
            config: shellConfig,
          };
          logger.info(`Micro-frontend shell: ${shellPath}`);

          // Parse shell excludes from env var and config
          const envExcludes = Bun.env.GATEWAY_SHELL_EXCLUDES || config.shellExcludes || "";
          shellEnvExcludes = parseBasenames(envExcludes);
          if (shellEnvExcludes.size > 0) {
            logger.info(`Shell bypass basenames: ${Array.from(shellEnvExcludes).join(", ")}`);
          }
        } catch (err) {
          logger.error(`Failed to load shell config from ${shellPath}`, { error: err });
        }
      }

      // Initialize persistence with KeyVal
      try {
        const keyval = ctx.getPlugin("@buntime/plugin-keyval") as KvLike | null;
        if (keyval && typeof keyval.get === "function") {
          await persistence.init(keyval, logger);

          // Load persisted shell excludes into memory
          const persistedExcludes = await persistence.getShellExcludes();
          shellKeyValExcludes = new Set(persistedExcludes);
          if (persistedExcludes.length > 0) {
            logger.info(
              `Loaded ${persistedExcludes.length} shell excludes from KeyVal: ${persistedExcludes.join(", ")}`,
            );
          }

          // Start metrics snapshot collection
          if (rateLimiter) {
            persistence.startSnapshotCollection(createMetricsSnapshot);
            logger.debug("Started metrics snapshot collection");
          }
        } else {
          logger.warn("KeyVal plugin not available, persistence disabled");
        }
      } catch (err) {
        logger.warn("Failed to initialize persistence", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async onShutdown() {
      rateLimiter?.stopCleanup();
      await persistence.shutdown();
    },

    async onRequest(req, _app) {
      const url = new URL(req.url);
      const startTime = performance.now();
      const ip = getClientIp(req);

      // 0. Micro-frontend shell
      if (shell && pool) {
        const secFetchDest = req.headers.get(HttpHeaders.SEC_FETCH_DEST);
        const cookieHeader = req.headers.get("cookie");

        const isDocument = secFetchDest === "document";
        const isFrameEmbedding =
          secFetchDest === "iframe" || secFetchDest === "embed" || secFetchDest === "object";
        const isRootPath = !url.pathname.slice(1).includes("/");
        const isApiRoute = url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`);

        // Check env excludes, keyval excludes, and cookie excludes
        const shouldBypass = shouldBypassShell(
          url.pathname,
          cookieHeader,
          shellEnvExcludes,
          shellKeyValExcludes,
        );

        if (!isApiRoute && !shouldBypass && (isDocument || (isRootPath && !isFrameEmbedding))) {
          logger.debug(`Shell serving: ${url.pathname} (dest: ${secFetchDest || "none"})`);

          const reqWithBase = new Request(req.url, {
            method: req.method,
            headers: new Headers(req.headers),
            body: req.body,
          });
          reqWithBase.headers.set(HttpHeaders.BASE, "/");

          return pool.fetch(shell.dir, shell.config, reqWithBase);
        }

        if (shouldBypass && isDocument) {
          logger.debug(`Shell bypassed: ${url.pathname}`);
        }
      }

      // 1. Handle CORS preflight
      if (config.cors) {
        const preflightResponse = handlePreflight(req, config.cors);
        if (preflightResponse) {
          return preflightResponse;
        }
      }

      // 2. Rate limiting
      if (rateLimiter && !isExcluded(url.pathname, rateLimitExcludePatterns)) {
        const key = getRateLimitKey(req, config.rateLimit?.keyBy ?? "ip");
        const result = rateLimiter.isAllowed(key);

        if (!result.allowed) {
          logger.debug(`Rate limited: ${key}`);

          // Log the rate limited request
          requestLogger.log({
            ip,
            method: req.method,
            path: url.pathname,
            status: 429,
            duration: performance.now() - startTime,
            rateLimited: true,
          });

          return new Response(JSON.stringify({ error: "Too Many Requests" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": result.retryAfter.toString(),
              "X-RateLimit-Limit": (config.rateLimit?.requests ?? 100).toString(),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": (Date.now() + result.retryAfter * 1000).toString(),
            },
          });
        }

        // Add rate limit headers to request for downstream
        const newReq = new Request(req.url, {
          body: req.body,
          headers: new Headers(req.headers),
          method: req.method,
        });
        newReq.headers.set("X-RateLimit-Remaining", result.remaining.toString());

        req = newReq;
      }

      // Continue to next handler
      return;
    },

    async onResponse(res, _app) {
      // Note: onResponse doesn't receive original request, so we can't log here
      // Requests are logged in onRequest for rate-limited cases

      // Add CORS headers
      if (config.cors) {
        const headers = new Headers(res.headers);

        if (config.cors.origin === "*") {
          headers.set("Access-Control-Allow-Origin", "*");
        }

        if (config.cors.credentials) {
          headers.set("Access-Control-Allow-Credentials", "true");
        }

        if (config.cors.exposedHeaders?.length) {
          headers.set("Access-Control-Expose-Headers", config.cors.exposedHeaders.join(", "));
        }

        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      }

      return res;
    },

    routes,
  };
}

// Named exports
export { gatewayPlugin };
export type { GatewayRoutesType } from "./server/api";
export type { CorsConfig } from "./server/cors";
export { createPersistence, GatewayPersistence } from "./server/persistence";
export { parseWindow, RateLimiter, TokenBucket } from "./server/rate-limit";
export { RequestLogger } from "./server/request-log";
export type { GatewayConfig, GatewaySSEData, GatewayStats, RateLimitConfig } from "./server/types";
