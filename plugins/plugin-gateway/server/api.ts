import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ResponseCache } from "./cache";
import type { GatewayPersistence, ShellExcludeEntry } from "./persistence";
import type { RateLimiter } from "./rate-limit";
import type { RequestLogger } from "./request-log";
import type { GatewayConfig, GatewaySSEData, GatewayStats } from "./types";

/**
 * Dependencies for the Gateway API
 */
export interface GatewayApiDeps {
  /** Get current config */
  getConfig: () => GatewayConfig;
  /** Get rate limiter instance */
  getRateLimiter: () => RateLimiter | null;
  /** Get response cache instance (may be null if disabled) */
  getResponseCache: () => ResponseCache | null;
  /** Get request logger instance */
  getRequestLogger: () => RequestLogger;
  /** Get persistence instance */
  getPersistence: () => GatewayPersistence;
  /** Get shell configuration */
  getShellConfig: () => {
    dir: string;
    envExcludes: Set<string>;
    keyvalExcludes: Set<string>;
    addKeyValExclude: (basename: string) => void;
    removeKeyValExclude: (basename: string) => boolean;
  } | null;
  /** SSE update interval in milliseconds */
  sseInterval?: number;
}

/**
 * Build SSE data payload
 */
async function buildSSEData(deps: GatewayApiDeps): Promise<GatewaySSEData> {
  const config = deps.getConfig();
  const rateLimiter = deps.getRateLimiter();
  const logger = deps.getRequestLogger();
  const persistence = deps.getPersistence();
  const shellConfig = deps.getShellConfig();

  // Get shell excludes (combined env + keyval)
  let shellExcludes: ShellExcludeEntry[] = [];
  if (shellConfig) {
    shellExcludes = await persistence.getAllShellExcludes(shellConfig.envExcludes);
  }

  return {
    timestamp: Date.now(),

    rateLimit: rateLimiter
      ? {
          metrics: rateLimiter.getMetrics(),
          config: {
            requests: config.rateLimit?.requests ?? 100,
            window: config.rateLimit?.window ?? "1m",
            keyBy:
              typeof config.rateLimit?.keyBy === "function"
                ? "ip"
                : (config.rateLimit?.keyBy ?? "ip"),
          },
        }
      : null,

    cors: config.cors
      ? {
          enabled: true,
          origin: typeof config.cors.origin === "function" ? "*" : (config.cors.origin ?? "*"),
          credentials: config.cors.credentials ?? false,
          methods: config.cors.methods ?? ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
        }
      : null,

    shell: shellConfig
      ? {
          enabled: true,
          dir: shellConfig.dir,
          excludes: shellExcludes,
        }
      : null,

    recentLogs: logger.getRecent(10),
  };
}

/**
 * Create gateway API routes
 */
export function createGatewayApi(deps: GatewayApiDeps) {
  const sseInterval = deps.sseInterval ?? 1000;

  return (
    new Hono()
      .basePath("/api")

      // =========================================================================
      // SSE - Real-time updates
      // =========================================================================
      .get("/sse", (ctx) => {
        return streamSSE(ctx, async (stream) => {
          while (true) {
            const data = await buildSSEData(deps);
            await stream.writeSSE({ data: JSON.stringify(data) });
            await stream.sleep(sseInterval);
          }
        });
      })

      // =========================================================================
      // Stats - Complete gateway statistics
      // =========================================================================
      .get("/stats", (ctx) => {
        const config = deps.getConfig();
        const rateLimiter = deps.getRateLimiter();
        const cache = deps.getResponseCache();
        const logger = deps.getRequestLogger();
        const shellConfig = deps.getShellConfig();

        const stats: GatewayStats = {
          rateLimit: {
            enabled: !!rateLimiter,
            metrics: rateLimiter?.getMetrics() ?? null,
            config: config.rateLimit ?? null,
          },
          cors: {
            enabled: !!config.cors,
            config: config.cors ?? null,
          },
          cache: {
            enabled: !!cache,
          },
          shell: {
            enabled: !!shellConfig,
            dir: shellConfig?.dir ?? null,
            excludesCount: shellConfig ? shellConfig.envExcludes.size + shellConfig.keyvalExcludes.size : 0,
          },
          logs: logger.getStats(),
        };

        return ctx.json(stats);
      })

      // =========================================================================
      // Config - Read-only configuration
      // =========================================================================
      .get("/config", (ctx) => {
        const config = deps.getConfig();
        const shellConfig = deps.getShellConfig();

        return ctx.json({
          rateLimit: config.rateLimit ?? null,
          cors: config.cors ?? null,
          cache: config.cache ?? null,
          shell: shellConfig
            ? {
                dir: shellConfig.dir,
                envExcludes: Array.from(shellConfig.envExcludes),
              }
            : null,
        });
      })

      // =========================================================================
      // Rate Limit - Metrics and management
      // =========================================================================
      .get("/rate-limit/metrics", (ctx) => {
        const rateLimiter = deps.getRateLimiter();
        if (!rateLimiter) {
          return ctx.json({ error: "Rate limiting not enabled" }, 400);
        }
        return ctx.json(rateLimiter.getMetrics());
      })

      .get("/rate-limit/buckets", (ctx) => {
        const rateLimiter = deps.getRateLimiter();
        if (!rateLimiter) {
          return ctx.json({ error: "Rate limiting not enabled" }, 400);
        }

        const limit = parseInt(ctx.req.query("limit") ?? "100");
        const buckets = rateLimiter.getActiveBuckets().slice(0, limit);

        return ctx.json(buckets);
      })

      .delete("/rate-limit/buckets/:key", (ctx) => {
        const rateLimiter = deps.getRateLimiter();
        if (!rateLimiter) {
          return ctx.json({ error: "Rate limiting not enabled" }, 400);
        }

        const key = decodeURIComponent(ctx.req.param("key"));
        const deleted = rateLimiter.clearBucket(key);

        return ctx.json({ deleted, key });
      })

      .post("/rate-limit/clear", (ctx) => {
        const rateLimiter = deps.getRateLimiter();
        if (!rateLimiter) {
          return ctx.json({ error: "Rate limiting not enabled" }, 400);
        }

        const count = rateLimiter.clearAllBuckets();
        return ctx.json({ cleared: count });
      })

      // =========================================================================
      // Metrics History - Historical data from KeyVal
      // =========================================================================
      .get("/metrics/history", async (ctx) => {
        const persistence = deps.getPersistence();
        const limit = parseInt(ctx.req.query("limit") ?? "60");

        const history = await persistence.getMetricsHistory(limit);
        return ctx.json(history);
      })

      .delete("/metrics/history", async (ctx) => {
        const persistence = deps.getPersistence();
        await persistence.clearMetricsHistory();
        return ctx.json({ cleared: true });
      })

      // =========================================================================
      // Shell Excludes - Management
      // =========================================================================
      .get("/shell/excludes", async (ctx) => {
        const persistence = deps.getPersistence();
        const shellConfig = deps.getShellConfig();

        if (!shellConfig) {
          return ctx.json({ error: "Shell not configured" }, 400);
        }

        const excludes = await persistence.getAllShellExcludes(shellConfig.envExcludes);
        return ctx.json(excludes);
      })

      .post("/shell/excludes", async (ctx) => {
        const persistence = deps.getPersistence();
        const shellConfig = deps.getShellConfig();

        if (!shellConfig) {
          return ctx.json({ error: "Shell not configured" }, 400);
        }

        const body = await ctx.req.json<{ basename: string }>();
        const basename = body.basename?.trim();

        if (!basename) {
          return ctx.json({ error: "basename is required" }, 400);
        }

        // Validate basename (alphanumeric, hyphen, underscore only)
        if (!/^[a-zA-Z0-9_-]+$/.test(basename)) {
          return ctx.json({ error: "Invalid basename format" }, 400);
        }

        // Check if already in env excludes
        if (shellConfig.envExcludes.has(basename)) {
          return ctx.json({ error: "Already excluded via environment" }, 400);
        }

        const added = await persistence.addShellExclude(basename);

        // Update in-memory set for immediate effect
        if (added) {
          shellConfig.addKeyValExclude(basename);
        }

        return ctx.json({ added, basename, source: "keyval" });
      })

      .delete("/shell/excludes/:basename", async (ctx) => {
        const persistence = deps.getPersistence();
        const shellConfig = deps.getShellConfig();

        if (!shellConfig) {
          return ctx.json({ error: "Shell not configured" }, 400);
        }

        const basename = ctx.req.param("basename");

        // Cannot remove env excludes
        if (shellConfig.envExcludes.has(basename)) {
          return ctx.json({ error: "Cannot remove environment-based exclude" }, 400);
        }

        const removed = await persistence.removeShellExclude(basename);

        // Update in-memory set for immediate effect
        if (removed) {
          shellConfig.removeKeyValExclude(basename);
        }

        return ctx.json({ removed, basename });
      })

      // =========================================================================
      // Logs - Request logs
      // =========================================================================
      .get("/logs", (ctx) => {
        const logger = deps.getRequestLogger();

        const limit = parseInt(ctx.req.query("limit") ?? "50");
        const ip = ctx.req.query("ip");
        const rateLimited = ctx.req.query("rateLimited");
        const statusRange = ctx.req.query("statusRange");

        const logs = logger.filter({
          limit,
          ip: ip || undefined,
          rateLimited: rateLimited === "true" ? true : undefined,
          statusRange: statusRange ? parseInt(statusRange) : undefined,
        });

        return ctx.json(logs);
      })

      .delete("/logs", (ctx) => {
        const logger = deps.getRequestLogger();
        logger.clear();
        return ctx.json({ cleared: true });
      })

      .get("/logs/stats", (ctx) => {
        const logger = deps.getRequestLogger();
        return ctx.json(logger.getStats());
      })

      // =========================================================================
      // Cache - Invalidation (legacy, currently disabled)
      // =========================================================================
      .post("/cache/invalidate", async (ctx) => {
        const body = await ctx.req.json<{ pattern?: string; key?: string }>();

        const cache = deps.getResponseCache();
        if (!cache) {
          return ctx.json({ error: "Cache not enabled" }, 400);
        }

        if (body.key) {
          const deleted = cache.invalidate(body.key);
          return ctx.json({ invalidated: deleted ? 1 : 0 });
        }

        if (body.pattern) {
          const count = cache.invalidatePattern(new RegExp(body.pattern));
          return ctx.json({ invalidated: count });
        }

        cache.clear();
        return ctx.json({ invalidated: "all" });
      })

      // =========================================================================
      // Error handling
      // =========================================================================
      .onError((err) => {
        console.error("[Gateway] API Error:", err);
        return errorToResponse(err);
      })
  );
}

export type GatewayRoutesType = ReturnType<typeof createGatewayApi>;
