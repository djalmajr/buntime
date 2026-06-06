import { errorToResponse, ValidationError } from "@buntime/shared/errors";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ResponseCache } from "./cache";
import type { CorsRule } from "./cors";
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
  /**
   * Lazy auth middleware. Called on each request — returns the X-API-Key
   * middleware once the plugin has been initialised with the runtime auth
   * context, or `undefined` before `onInit` runs (in which case admin
   * routes are unprotected — typical for unit-test environments).
   */
  getMiddleware?: () => MiddlewareHandler | undefined;
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
    source: "override" | "default";
    seedDir: string | null;
    envExcludes: Set<string>;
    tursoExcludes: Set<string>;
    addTursoExclude: (basename: string) => void;
    removeTursoExclude: (basename: string) => boolean;
  } | null;
  /** Set a runtime shell directory override (validated, applied without restart) */
  setShellDir: (dir: string) => Promise<void>;
  /** Clear the shell dir override, reverting to the ConfigMap/env seed */
  resetShellDir: () => Promise<void>;
  /** Current per-domain CORS rules */
  getCorsRules: () => CorsRule[];
  /** Insert or update a CORS rule (persisted, applied immediately) */
  saveCorsRule: (rule: CorsRule) => Promise<void>;
  /** Delete a CORS rule by id */
  deleteCorsRule: (id: string) => Promise<boolean>;
  /** SSE update interval in milliseconds */
  sseInterval?: number;
}

const VALID_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Validate and normalize a per-domain CORS rule payload from the admin UI.
 * `id`/`createdAt` are supplied by the caller (new vs. update). Throws
 * ValidationError on malformed input.
 */
function parseCorsRule(body: unknown, id: string, createdAt: number): CorsRule {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Invalid CORS rule payload", "INVALID_CORS_RULE");
  }
  const raw = body as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    throw new ValidationError("A rule name is required", "CORS_NAME_REQUIRED");
  }

  const origins = toStringArray(raw.origins);
  if (origins.length === 0) {
    throw new ValidationError("At least one origin is required", "CORS_ORIGINS_REQUIRED");
  }

  const credentials = raw.credentials === true;
  if (credentials && origins.includes("*")) {
    throw new ValidationError(
      "Credentials cannot be enabled with a wildcard (*) origin. Specify explicit origins.",
      "CORS_CREDENTIALS_WILDCARD",
    );
  }

  const methods = toStringArray(raw.methods).map((m) => m.toUpperCase());
  const invalid = methods.find((m) => !VALID_METHODS.includes(m));
  if (invalid) {
    throw new ValidationError(`Invalid HTTP method: ${invalid}`, "CORS_INVALID_METHOD");
  }

  let maxAge = 86400;
  if (raw.maxAge !== undefined && raw.maxAge !== null && raw.maxAge !== "") {
    const parsed = Number(raw.maxAge);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError("maxAge must be a non-negative number", "CORS_INVALID_MAX_AGE");
    }
    maxAge = Math.floor(parsed);
  }

  return {
    id,
    name,
    origins,
    methods: methods.length ? methods : ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
    allowedHeaders: toStringArray(raw.allowedHeaders),
    exposedHeaders: toStringArray(raw.exposedHeaders),
    credentials,
    maxAge,
    createdAt,
  };
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

  // Get shell excludes (combined env + Turso)
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

    cors: (() => {
      const rules = deps.getCorsRules();
      return { enabled: rules.length > 0, rules };
    })(),

    shell: shellConfig
      ? {
          enabled: true,
          dir: shellConfig.dir,
          source: shellConfig.source,
          seedDir: shellConfig.seedDir,
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

  const app = new Hono().basePath("/admin");

  // Lazy auth gate. Defers middleware resolution to request time so the API
  // can be constructed at module load before onInit wires the auth context.
  app.use("*", async (c, next) => {
    const middleware = deps.getMiddleware?.();
    if (middleware) return middleware(c, next);
    return next();
  });

  return (
    app

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
            enabled: deps.getCorsRules().length > 0,
            rulesCount: deps.getCorsRules().length,
          },
          cache: {
            enabled: !!cache,
          },
          shell: {
            enabled: !!shellConfig,
            dir: shellConfig?.dir ?? null,
            excludesCount: shellConfig
              ? shellConfig.envExcludes.size + shellConfig.tursoExcludes.size
              : 0,
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
          cors: deps.getCorsRules(),
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
      // CORS - Per-domain rules (runtime-editable)
      // =========================================================================
      // Rules are persisted in Turso and applied immediately, so operators can
      // tune cross-origin policy per domain without restarting the gateway
      // (which serves other workers and must stay available).
      .get("/cors/rules", (ctx) => {
        return ctx.json(deps.getCorsRules());
      })

      .post("/cors/rules", async (ctx) => {
        const body = await ctx.req.json().catch(() => null);
        const rule = parseCorsRule(body, crypto.randomUUID(), Date.now());
        await deps.saveCorsRule(rule);
        return ctx.json(rule, 201);
      })

      .put("/cors/rules/:id", async (ctx) => {
        const id = ctx.req.param("id");
        const existing = deps.getCorsRules().find((r) => r.id === id);
        if (!existing) {
          return ctx.json({ error: "Rule not found" }, 404);
        }
        const body = await ctx.req.json().catch(() => null);
        const rule = parseCorsRule(body, id, existing.createdAt ?? Date.now());
        await deps.saveCorsRule(rule);
        return ctx.json(rule);
      })

      .delete("/cors/rules/:id", async (ctx) => {
        const removed = await deps.deleteCorsRule(ctx.req.param("id"));
        return ctx.json({ removed });
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

        const limit = parseInt(ctx.req.query("limit") ?? "100", 10);
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
      // Metrics History - Historical data from Turso
      // =========================================================================
      .get("/metrics/history", async (ctx) => {
        const persistence = deps.getPersistence();
        const limit = parseInt(ctx.req.query("limit") ?? "60", 10);

        const history = await persistence.getMetricsHistory(limit);
        return ctx.json(history);
      })

      .delete("/metrics/history", async (ctx) => {
        const persistence = deps.getPersistence();
        await persistence.clearMetricsHistory();
        return ctx.json({ cleared: true });
      })

      // =========================================================================
      // Shell Configuration - directory (ConfigMap/env seed + runtime override)
      // =========================================================================
      .put("/shell/config", async (ctx) => {
        const body = await ctx.req.json().catch(() => null);
        const dir = (body as { dir?: unknown })?.dir;
        if (typeof dir !== "string" || !dir.trim()) {
          throw new ValidationError("A shell directory is required", "SHELL_DIR_REQUIRED");
        }
        try {
          await deps.setShellDir(dir.trim());
        } catch (err) {
          return ctx.json(
            { error: err instanceof Error ? err.message : "Invalid shell directory" },
            400,
          );
        }
        const shellConfig = deps.getShellConfig();
        return ctx.json({ dir: shellConfig?.dir ?? dir.trim(), source: "override" });
      })

      .post("/shell/config/reset", async (ctx) => {
        await deps.resetShellDir();
        const shellConfig = deps.getShellConfig();
        return ctx.json({
          dir: shellConfig?.dir ?? null,
          source: shellConfig?.source ?? "default",
          enabled: !!shellConfig,
        });
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
          shellConfig.addTursoExclude(basename);
        }

        return ctx.json({ added, basename, source: "turso" });
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
          shellConfig.removeTursoExclude(basename);
        }

        return ctx.json({ removed, basename });
      })

      // =========================================================================
      // Logs - Request logs
      // =========================================================================
      .get("/logs", (ctx) => {
        const logger = deps.getRequestLogger();

        const limit = parseInt(ctx.req.query("limit") ?? "50", 10);
        const ip = ctx.req.query("ip");
        const rateLimited = ctx.req.query("rateLimited");
        const statusRange = ctx.req.query("statusRange");

        const logs = logger.filter({
          limit,
          ip: ip || undefined,
          rateLimited: rateLimited === "true" ? true : undefined,
          statusRange: statusRange ? parseInt(statusRange, 10) : undefined,
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
