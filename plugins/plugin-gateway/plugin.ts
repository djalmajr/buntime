import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import { loadManifestConfig } from "@buntime/shared/utils/buntime-config";
import { parseWorkerConfig, type WorkerConfig } from "@buntime/shared/utils/worker-config";
import { createGatewayApi } from "./server/api";
// import { ResponseCache } from "./server/cache"; // Cache disabled
import { handlePreflight } from "./server/cors";
import { parseWindow, RateLimiter } from "./server/rate-limit";
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

let rateLimiter: RateLimiter | null = null;
// let responseCache: ResponseCache | null = null; // Cache disabled
let config: GatewayConfig = {};
let rateLimitExcludePatterns: RegExp[] = [];
// let cacheExcludePatterns: RegExp[] = []; // Cache disabled
let logger: PluginContext["logger"];

// Micro-frontend shell state
let pool: PoolLike | null = null;
let shell: ResolvedShell | null = null;
let shellExcludes: Set<string> = new Set();

// Runtime API path (from context)
let apiPath: string = "/api";

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
 * Gateway plugin for Buntime
 *
 * Provides:
 * - Rate limiting (token bucket algorithm)
 * - Response caching (in-memory)
 * - CORS handling
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
 * cache:
 *   ttl: 300
 *   methods:
 *     - GET
 * cors:
 *   origin: "*"
 *   credentials: false
 * ```
 */
export default function gatewayPlugin(pluginConfig: GatewayConfig = {}): PluginImpl {
  config = pluginConfig;

  const routes = createGatewayApi(
    () => config,
    () => (rateLimiter ? { enabled: true } : null),
    () => null, // responseCache Cache disabled
  );

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

      // Initialize cache (disabled)
      // if (config.cache) {
      //   responseCache = new ResponseCache(config.cache.maxEntries ?? 1000);
      //   responseCache.startCleanup();
      //
      //   cacheExcludePatterns = (config.cache.excludePaths ?? []).map((p) => new RegExp(p));
      //
      //   logger.info(
      //     `Response caching: TTL ${config.cache.ttl ?? 60}s, methods ${(config.cache.methods ?? ["GET"]).join(", ")}`,
      //   );
      // }

      // Log CORS config
      if (config.cors) {
        logger.info(`CORS enabled: origin=${JSON.stringify(config.cors.origin)}`);
      }

      // Initialize micro-frontend shell
      // Check env var first, then config
      const shellPath = Bun.env.GATEWAY_SHELL_DIR || config.shellDir;
      if (shellPath && ctx.pool) {
        pool = ctx.pool as PoolLike;

        try {
          // Load and parse shell config using shared utilities
          const manifestConfig = await loadManifestConfig(shellPath);
          const shellConfig = parseWorkerConfig(manifestConfig);

          shell = {
            dir: shellPath,
            config: shellConfig,
          };
          logger.info(`Micro-frontend shell: ${shellPath}`);

          // Parse shell excludes from env var and config
          const envExcludes = Bun.env.GATEWAY_SHELL_EXCLUDES || config.shellExcludes || "";
          shellExcludes = parseBasenames(envExcludes);
          if (shellExcludes.size > 0) {
            logger.info(`Shell bypass basenames: ${Array.from(shellExcludes).join(", ")}`);
          }
        } catch (err) {
          logger.error(`Failed to load shell config from ${shellPath}`, { error: err });
        }
      }
    },

    onShutdown() {
      rateLimiter?.stopCleanup();
      // responseCache?.stopCleanup(); // Cache disabled
    },

    async onRequest(req, _app) {
      const url = new URL(req.url);

      // 0. Micro-frontend shell
      // Shell serves all document navigations and root-level assets
      if (shell && pool) {
        const secFetchDest = req.headers.get(HttpHeaders.SEC_FETCH_DEST);
        const cookieHeader = req.headers.get("cookie");

        // Document navigation (browser address bar, links, form submissions)
        const isDocument = secFetchDest === "document";

        // Frame embeddings should go to their respective workers, not shell
        const isFrameEmbedding =
          secFetchDest === "iframe" || secFetchDest === "embed" || secFetchDest === "object";

        // Root path = no subpath (e.g., "/chunk.css" not "/deployments/chunk.css")
        const isRootPath = !url.pathname.slice(1).includes("/");

        // API routes are handled by other parts of the system
        const isApiRoute = url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`);

        // Check if basename is excluded from shell (via env or cookie)
        const shouldBypass = shouldBypassShell(url.pathname, cookieHeader, shellExcludes);

        // Shell serves:
        // 1. All document navigations (shell owns all pages) - unless bypassed
        // 2. Root path requests that are not frame embeddings (shell's assets)
        if (!isApiRoute && !shouldBypass && (isDocument || (isRootPath && !isFrameEmbedding))) {
          logger.debug(`Shell serving: ${url.pathname} (dest: ${secFetchDest || "none"})`);

          // Add x-base header for <base href> injection (shell always serves from root)
          // This enables SPAs with relative asset paths to work under any route
          const reqWithBase = new Request(req.url, {
            method: req.method,
            headers: new Headers(req.headers),
            body: req.body,
          });
          reqWithBase.headers.set(HttpHeaders.BASE, "/");

          return pool.fetch(shell.dir, shell.config, reqWithBase);
        }

        // Log bypass for debugging
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

      // 3. Check cache (disabled)
      // if (responseCache && !isExcluded(url.pathname, cacheExcludePatterns)) {
      //   const methods = config.cache?.methods ?? ["GET"];
      //
      //   if (responseCache.isCacheable(req, methods)) {
      //     const key = responseCache.getKey(req);
      //     const cached = responseCache.get(key);
      //
      //     if (cached) {
      //       logger.debug(`Cache hit: ${key}`);
      //
      //       // Add CORS headers if needed
      //       if (config.cors) {
      //         return addCorsHeaders(req, cached, config.cors);
      //       }
      //
      //       return cached;
      //     }
      //   }
      // }

      // Continue to next handler
      return;
    },

    async onResponse(res, _app) {
      // Store in cache (disabled)
      // if (responseCache) {
      //   // Need access to original request - not available here
      //   // Cache storing is handled in a different way (would need middleware pattern)
      // }

      // Add CORS headers
      if (config.cors) {
        // Need access to original request for origin check
        // For now, add permissive headers
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
// export { ResponseCache } from "./server/cache"; // Cache disabled
export type { CorsConfig } from "./server/cors";
export { parseWindow, RateLimiter, TokenBucket } from "./server/rate-limit";
export type { GatewayConfig, RateLimitConfig } from "./server/types";
// export type { CacheConfig } from "./server/types"; // Cache disabled
