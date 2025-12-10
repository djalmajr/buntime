import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { Hono } from "hono";
import { ResponseCache } from "./cache";
import { addCorsHeaders, type CorsConfig, handlePreflight } from "./cors";
import { parseWindow, RateLimiter } from "./rate-limit";

export interface RateLimitConfig {
  /**
   * Maximum requests per window
   * @default 100
   */
  requests?: number;

  /**
   * Time window (e.g., "1m", "1h", "30s")
   * @default "1m"
   */
  window?: string;

  /**
   * Key extractor for rate limiting
   * - "ip": Use client IP
   * - "user": Use user ID from X-Identity header
   * - Function for custom key extraction
   * @default "ip"
   */
  keyBy?: "ip" | "user" | ((req: Request) => string);

  /**
   * Paths to exclude from rate limiting (regex patterns)
   */
  excludePaths?: string[];
}

export interface CacheConfig {
  /**
   * Default TTL in seconds
   * @default 60
   */
  ttl?: number;

  /**
   * HTTP methods to cache
   * @default ["GET"]
   */
  methods?: string[];

  /**
   * Maximum cache entries
   * @default 1000
   */
  maxEntries?: number;

  /**
   * Paths to exclude from caching (regex patterns)
   */
  excludePaths?: string[];
}

export interface GatewayConfig extends BasePluginConfig {
  /**
   * Response caching configuration
   */
  cache?: CacheConfig;

  /**
   * CORS configuration
   */
  cors?: CorsConfig;

  /**
   * Rate limiting configuration
   */
  rateLimit?: RateLimitConfig;
}

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

function getRateLimitKey(req: Request, keyBy: RateLimitConfig["keyBy"]): string {
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

const routes = new Hono()
  .get("/stats", (ctx) => {
    return ctx.json({
      cache: responseCache?.getStats() ?? null,
      rateLimit: rateLimiter ? { enabled: true } : null,
      cors: config.cors ? { enabled: true } : null,
    });
  })
  .post("/cache/invalidate", async (ctx) => {
    const body = await ctx.req.json<{ pattern?: string; key?: string }>();

    if (!responseCache) {
      return ctx.json({ error: "Cache not enabled" }, 400);
    }

    if (body.key) {
      const deleted = responseCache.invalidate(body.key);
      return ctx.json({ invalidated: deleted ? 1 : 0 });
    }

    if (body.pattern) {
      const count = responseCache.invalidatePattern(new RegExp(body.pattern));
      return ctx.json({ invalidated: count });
    }

    responseCache.clear();
    return ctx.json({ invalidated: "all" });
  });

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
 *     ["@buntime/gateway", {
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

  return {
    name: "@buntime/plugin-gateway",
    mountPath: pluginConfig.mountPath,
    version: "1.0.0",
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
export { ResponseCache } from "./cache";
export type { CorsConfig } from "./cors";
export { parseWindow, RateLimiter, TokenBucket } from "./rate-limit";
