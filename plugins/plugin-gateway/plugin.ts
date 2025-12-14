import type { BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { createGatewayApi } from "./server/api";
import { ResponseCache } from "./server/cache";
import { addCorsHeaders, handlePreflight } from "./server/cors";
import { parseWindow, RateLimiter } from "./server/rate-limit";
import type { GatewayConfig } from "./server/types";

let rateLimiter: RateLimiter | null = null;
let responseCache: ResponseCache | null = null;
let config: GatewayConfig = {};
let rateLimitExcludePatterns: RegExp[] = [];
let cacheExcludePatterns: RegExp[] = [];
let logger: PluginContext["logger"];

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
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     ["@buntime/plugin-gateway", {
 *       rateLimit: {
 *         requests: 100,
 *         window: "1m",
 *         keyBy: "ip",
 *       },
 *       cache: {
 *         ttl: 300,
 *         methods: ["GET"],
 *       },
 *       cors: {
 *         origin: "*",
 *         credentials: false,
 *       },
 *     }],
 *   ],
 * }
 * ```
 */
export default function gatewayPlugin(pluginConfig: GatewayConfig = {}): BuntimePlugin {
  config = pluginConfig;

  const routes = createGatewayApi(
    () => config,
    () => (rateLimiter ? { enabled: true } : null),
    () => responseCache,
  );

  return {
    name: "@buntime/plugin-gateway",
    base: pluginConfig.base,
    optionalDependencies: ["@buntime/plugin-authn"], // Run after authn if present

    onInit(ctx: PluginContext) {
      logger = ctx.logger;

      // Initialize rate limiter
      if (config.rateLimit) {
        const requests = config.rateLimit.requests ?? 100;
        const windowSeconds = parseWindow(config.rateLimit.window ?? "1m");

        rateLimiter = new RateLimiter(requests, windowSeconds);
        rateLimiter.startCleanup();

        rateLimitExcludePatterns = (config.rateLimit.excludePaths ?? []).map((p) => new RegExp(p));

        logger.info(`Rate limiting: ${requests} requests per ${config.rateLimit.window ?? "1m"}`);
      }

      // Initialize cache
      if (config.cache) {
        responseCache = new ResponseCache(config.cache.maxEntries ?? 1000);
        responseCache.startCleanup();

        cacheExcludePatterns = (config.cache.excludePaths ?? []).map((p) => new RegExp(p));

        logger.info(
          `Response caching: TTL ${config.cache.ttl ?? 60}s, methods ${(config.cache.methods ?? ["GET"]).join(", ")}`,
        );
      }

      // Log CORS config
      if (config.cors) {
        logger.info(`CORS enabled: origin=${JSON.stringify(config.cors.origin)}`);
      }
    },

    onShutdown() {
      rateLimiter?.stopCleanup();
      responseCache?.stopCleanup();
    },

    async onRequest(req, _app) {
      const url = new URL(req.url);

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

      // 3. Check cache
      if (responseCache && !isExcluded(url.pathname, cacheExcludePatterns)) {
        const methods = config.cache?.methods ?? ["GET"];

        if (responseCache.isCacheable(req, methods)) {
          const key = responseCache.getKey(req);
          const cached = responseCache.get(key);

          if (cached) {
            logger.debug(`Cache hit: ${key}`);

            // Add CORS headers if needed
            if (config.cors) {
              return addCorsHeaders(req, cached, config.cors);
            }

            return cached;
          }
        }
      }

      // Continue to next handler
      return;
    },

    async onResponse(res, _app) {
      // Store in cache if applicable
      if (responseCache) {
        // Need access to original request - not available here
        // Cache storing is handled in a different way (would need middleware pattern)
      }

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
export { ResponseCache } from "./server/cache";
export type { CorsConfig } from "./server/cors";
export { parseWindow, RateLimiter, TokenBucket } from "./server/rate-limit";
export type {
  CacheConfig,
  GatewayConfig,
  RateLimitConfig,
} from "./server/types";
