import { existsSync } from "node:fs";
import type { TursoService } from "@buntime/plugin-turso";
import type { ApiKeyStore } from "@buntime/shared/api-keys";
import { createApiKeyMiddleware } from "@buntime/shared/middleware/api-key";
import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import { loadManifestConfig } from "@buntime/shared/utils/buntime-config";
import { parseWorkerConfig, type WorkerConfig } from "@buntime/shared/utils/worker-config";
import type { MiddlewareHandler } from "hono";
import { createGatewayApi, type GatewayApiDeps } from "./server/api";
import {
  addCorsHeaders,
  type CorsConfig,
  type CorsRule,
  handlePreflight,
  resolveCors,
} from "./server/cors";
import {
  createPersistence,
  type GatewayPersistence,
  type MetricsSnapshot,
} from "./server/persistence";
import { parseWindow, RateLimiter } from "./server/rate-limit";
import { RequestLogger } from "./server/request-log";
import { parseBasenames, shouldBypassShell } from "./server/shell-bypass";
import { matchShellRouteDir, normalizeRouteHost, type ShellRoute } from "./server/shell-routes";
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

// Per-domain CORS rules, loaded from Turso at init and editable at runtime.
// The request path matches the incoming Origin against these rules.
let corsRules: CorsRule[] = [];

// Micro-frontend shell state
let pool: PoolLike | null = null;
let shell: ResolvedShell | null = null;
let shellEnvExcludes: Set<string> = new Set();
let shellTursoExcludes: Set<string> = new Set();
// Shell dir seed (ConfigMap/env/manifest) and whether a runtime DB override is active.
let shellSeedDir: string | undefined;
let shellDirOverride = false;
// Per-host (tenant) shell routes, loaded from Turso at init and editable at
// runtime. A matching route overrides the global shell for that host.
let shellRoutes: ShellRoute[] = [];
// Cache of resolved shells keyed by dir, to avoid re-parsing manifests per
// request. Cleared whenever a shell route or the global shell changes.
const resolvedShellCache = new Map<string, ResolvedShell>();

const SHELL_DIR_SETTING = "shell_dir";

/**
 * Resolve a shell directory into a ResolvedShell (loads its manifest worker
 * config). Throws if the directory is missing or has no valid manifest.
 */
async function resolveShell(dir: string): Promise<ResolvedShell> {
  if (!existsSync(dir)) {
    throw new Error(`Shell directory does not exist: ${dir}`);
  }
  const manifestConfig = await loadManifestConfig(dir);
  return { dir, config: parseWorkerConfig(manifestConfig) };
}

/**
 * Resolve the shell to serve for a request host: a matching per-host route wins,
 * otherwise the global shell. Results are cached by dir. Returns null when no
 * shell applies.
 */
async function resolveShellForHost(host: string): Promise<ResolvedShell | null> {
  const routeDir = matchShellRouteDir(host, shellRoutes);
  const dir = routeDir ?? shell?.dir;
  if (!dir) return null;

  const cached = resolvedShellCache.get(dir);
  if (cached) return cached;

  // The global shell is already resolved — reuse it without re-parsing.
  if (!routeDir && shell) {
    resolvedShellCache.set(shell.dir, shell);
    return shell;
  }

  try {
    const resolved = await resolveShell(dir);
    resolvedShellCache.set(dir, resolved);
    return resolved;
  } catch (err) {
    logger?.error(`Failed to resolve shell for host ${host} (${dir})`, { error: err });
    return null;
  }
}

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
 * Build the base CORS config from the manifest, applying env-var overrides
 * (`GATEWAY_CORS_ORIGIN`, `GATEWAY_CORS_CREDENTIALS`) on top. This is the
 * deploy-time default; a persisted runtime override (Turso) takes precedence
 * over it. Returns `undefined` when CORS is not configured anywhere.
 */
function buildBaseCors(manifestCors: CorsConfig | undefined): CorsConfig | undefined {
  const envOrigin = Bun.env.GATEWAY_CORS_ORIGIN;
  const envCredentials = Bun.env.GATEWAY_CORS_CREDENTIALS;

  if (!manifestCors && envOrigin === undefined && envCredentials === undefined) {
    return undefined;
  }

  const base: CorsConfig = { ...(manifestCors ?? {}) };

  if (envOrigin !== undefined) {
    base.origin = parseOrigin(envOrigin);
  }
  if (envCredentials !== undefined) {
    base.credentials = envCredentials === "true";
  }

  return base;
}

/**
 * Normalize an origin string into the CorsConfig shape: "*" stays a wildcard,
 * a single value stays a string, and a comma/space separated list becomes an
 * array.
 */
export function parseOrigin(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed === "*") return "*";
  const list = trimmed
    .split(/[\s,]+/)
    .map((o) => o.trim())
    .filter(Boolean);
  return list.length <= 1 ? (list[0] ?? "*") : list;
}

/**
 * Convert a single CorsConfig (manifest/env base) into a seed CorsRule used
 * to bootstrap the rule list on first run.
 */
function corsConfigToRule(cors: CorsConfig): CorsRule {
  let origins: string[];
  if (cors.origin === undefined || cors.origin === "*" || typeof cors.origin === "function") {
    origins = ["*"];
  } else if (Array.isArray(cors.origin)) {
    origins = cors.origin.length ? cors.origin : ["*"];
  } else {
    origins = [cors.origin];
  }

  return {
    id: crypto.randomUUID(),
    name: origins.includes("*") ? "All origins" : "Default",
    origins,
    methods: cors.methods ?? ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
    allowedHeaders: cors.allowedHeaders ?? [],
    exposedHeaders: cors.exposedHeaders ?? [],
    credentials: cors.credentials ?? false,
    maxAge: cors.maxAge ?? 86400,
    createdAt: Date.now(),
  };
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
 *   requests: 1000
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

  // Initialize persistence (will connect to Turso in onInit)
  persistence = createPersistence();

  // Lazy-resolved auth middleware. Set at onInit once ctx.auth is known.
  let adminMiddleware: MiddlewareHandler | undefined;

  // Create API dependencies
  const apiDeps: GatewayApiDeps = {
    getConfig: () => config,
    getMiddleware: () => adminMiddleware,
    getRateLimiter: () => rateLimiter,
    getResponseCache: () => null, // Cache disabled
    getRequestLogger: () => requestLogger,
    getPersistence: () => persistence,
    getShellConfig: () =>
      shell
        ? {
            dir: shell.dir,
            source: shellDirOverride ? ("override" as const) : ("default" as const),
            seedDir: shellSeedDir ?? null,
            envExcludes: shellEnvExcludes,
            tursoExcludes: shellTursoExcludes,
            addTursoExclude: (basename: string) => shellTursoExcludes.add(basename),
            removeTursoExclude: (basename: string) => shellTursoExcludes.delete(basename),
          }
        : null,
    setShellDir: async (dir: string) => {
      if (!pool) {
        throw new Error("Worker pool is not available; cannot configure the shell");
      }
      // Validates the directory (throws if missing/invalid) before swapping.
      const next = await resolveShell(dir);
      shell = next;
      resolvedShellCache.clear();
      shellDirOverride = true;
      await persistence.setSetting(SHELL_DIR_SETTING, dir);
      logger?.info(`Shell dir override set: ${dir}`);
    },
    resetShellDir: async () => {
      await persistence.deleteSetting(SHELL_DIR_SETTING);
      shellDirOverride = false;
      if (shellSeedDir && pool) {
        try {
          shell = await resolveShell(shellSeedDir);
        } catch {
          shell = null;
        }
      } else {
        shell = null;
      }
      resolvedShellCache.clear();
      logger?.info("Shell dir override cleared, reverted to ConfigMap/env seed");
    },
    getCorsRules: () => corsRules,
    saveCorsRule: async (rule: CorsRule) => {
      await persistence.saveCorsRule(rule);
      const idx = corsRules.findIndex((r) => r.id === rule.id);
      if (idx >= 0) {
        corsRules[idx] = rule;
      } else {
        corsRules.push(rule);
      }
      logger?.info(`CORS rule saved: ${rule.name} (${rule.origins.join(", ")})`);
    },
    deleteCorsRule: async (id: string) => {
      const removed = await persistence.deleteCorsRule(id);
      if (removed) {
        corsRules = corsRules.filter((r) => r.id !== id);
        logger?.info(`CORS rule deleted: ${id}`);
      }
      return removed;
    },
    getShellRoutes: () => shellRoutes.map((r) => ({ ...r })),
    saveShellRoute: async (host: string, dir: string) => {
      if (!pool) {
        throw new Error("Worker pool is not available; cannot configure the shell");
      }
      const normalized = normalizeRouteHost(host);
      if (!normalized) {
        throw new Error(`Invalid host: ${host}`);
      }
      // Validate the dir (throws if missing/invalid) before persisting.
      await resolveShell(dir);
      await persistence.saveShellRoute(normalized, dir);
      const entry: ShellRoute = { host: normalized, dir, createdAt: Date.now() };
      const idx = shellRoutes.findIndex((r) => r.host === normalized);
      if (idx >= 0) {
        shellRoutes[idx] = entry;
      } else {
        shellRoutes.push(entry);
      }
      resolvedShellCache.clear();
      logger?.info(`Shell route set: ${normalized} -> ${dir}`);
    },
    deleteShellRoute: async (host: string) => {
      const normalized = normalizeRouteHost(host) ?? host.trim().toLowerCase();
      const removed = await persistence.deleteShellRoute(normalized);
      if (removed) {
        shellRoutes = shellRoutes.filter((r) => r.host !== normalized);
        resolvedShellCache.clear();
        logger?.info(`Shell route deleted: ${normalized}`);
      }
      return removed;
    },
    sseInterval: 1000,
  };

  const routes = createGatewayApi(apiDeps);

  return {
    async onInit(ctx: PluginContext) {
      logger = ctx.logger;
      apiPath = ctx.runtime.api;

      // Wire X-API-Key gate for /<base>/admin/** (control plane).
      const store = ctx.auth?.store as ApiKeyStore | undefined;
      const rootKey = ctx.auth?.rootKey;
      if (store || rootKey) {
        adminMiddleware = createApiKeyMiddleware({ rootKey, store });
      }

      // Initialize rate limiter
      if (config.rateLimit) {
        const requests = config.rateLimit.requests ?? 100;
        const windowSeconds = parseWindow(config.rateLimit.window ?? "1m");

        rateLimiter = new RateLimiter(requests, windowSeconds);
        rateLimiter.startCleanup();

        rateLimitExcludePatterns = (config.rateLimit.excludePaths ?? []).map((p) => new RegExp(p));

        logger.info(`Rate limiting: ${requests} requests per ${config.rateLimit.window ?? "1m"}`);
      }

      // The base CORS (manifest + env) is used only to seed an initial rule
      // when no rules exist yet (see persistence init below).
      const baseCors = buildBaseCors(config.cors);

      // Capture the pool up front so the shell can be (re)configured at runtime
      // even when no seed directory was provided at boot.
      if (ctx.pool) {
        pool = ctx.pool as PoolLike;
      }

      // Initialize micro-frontend shell. ConfigMap/env (GATEWAY_SHELL_DIR) or the
      // manifest provide the seed directory; a DB override (loaded below) wins.
      shellSeedDir = Bun.env.GATEWAY_SHELL_DIR || config.shellDir || undefined;
      if (shellSeedDir && pool) {
        try {
          shell = await resolveShell(shellSeedDir);
          logger.info(`Micro-frontend shell: ${shellSeedDir}`);
        } catch (err) {
          logger.error(`Failed to load shell config from ${shellSeedDir}`, { error: err });
        }
      }

      // Parse shell excludes from env var and config (the non-removable seed set)
      const envExcludes = Bun.env.GATEWAY_SHELL_EXCLUDES || config.shellExcludes || "";
      shellEnvExcludes = parseBasenames(envExcludes);
      if (shellEnvExcludes.size > 0) {
        logger.info(`Shell bypass basenames: ${Array.from(shellEnvExcludes).join(", ")}`);
      }

      // Initialize persistence with Turso
      try {
        const turso = ctx.getPlugin<TursoService>("@buntime/plugin-turso");
        if (turso) {
          await persistence.init(turso, logger);

          // Load persisted shell excludes into memory
          const persistedExcludes = await persistence.getShellExcludes();
          shellTursoExcludes = new Set(persistedExcludes);
          if (persistedExcludes.length > 0) {
            logger.info(
              `Loaded ${persistedExcludes.length} shell excludes from Turso: ${persistedExcludes.join(", ")}`,
            );
          }

          // Load persisted shell dir override (wins over the ConfigMap/env seed)
          const shellDirOverrideValue = await persistence.getSetting(SHELL_DIR_SETTING);
          if (shellDirOverrideValue && pool) {
            try {
              shell = await resolveShell(shellDirOverrideValue);
              shellDirOverride = true;
              logger.info(`Loaded shell dir override from Turso: ${shellDirOverrideValue}`);
            } catch (err) {
              logger.error(
                `Persisted shell dir override is invalid (${shellDirOverrideValue}), keeping seed`,
                { error: err },
              );
            }
          }

          // Load persisted CORS rules. If none exist yet, seed one from the
          // manifest/env base so existing deployments keep their behavior.
          corsRules = await persistence.getCorsRules();
          if (corsRules.length === 0 && baseCors) {
            const seed = corsConfigToRule(baseCors);
            await persistence.saveCorsRule(seed);
            corsRules = [seed];
            logger.info(`Seeded initial CORS rule: ${seed.name} (${seed.origins.join(", ")})`);
          }
          if (corsRules.length > 0) {
            logger.info(`Loaded ${corsRules.length} CORS rule(s) from Turso`);
          }

          // Load persisted per-host shell routes
          shellRoutes = await persistence.getShellRoutes();
          if (shellRoutes.length > 0) {
            logger.info(`Loaded ${shellRoutes.length} shell route(s) from Turso`);
          }

          // Start metrics snapshot collection
          if (rateLimiter) {
            persistence.startSnapshotCollection(createMetricsSnapshot);
            logger.debug("Started metrics snapshot collection");
          }
        } else {
          logger.warn("Turso plugin not available, persistence disabled");
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

      // 0. Micro-frontend shell (per-host route, falling back to the global shell)
      if (pool && (shell || shellRoutes.length > 0)) {
        const secFetchDest = req.headers.get(HttpHeaders.SEC_FETCH_DEST);
        const cookieHeader = req.headers.get("cookie");

        const isDocument = secFetchDest === "document";
        const isFrameEmbedding =
          secFetchDest === "iframe" || secFetchDest === "embed" || secFetchDest === "object";
        const isRootPath = !url.pathname.slice(1).includes("/");
        const isApiRoute = url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`);

        // Check env excludes, Turso excludes, and cookie excludes
        const shouldBypass = shouldBypassShell(
          url.pathname,
          cookieHeader,
          shellEnvExcludes,
          shellTursoExcludes,
        );

        if (!isApiRoute && !shouldBypass && (isDocument || (isRootPath && !isFrameEmbedding))) {
          // Resolve the shell per host: a tenant route wins over the global shell.
          const resolved = await resolveShellForHost(url.host);
          if (resolved) {
            logger.debug(
              `Shell serving: ${url.pathname} (host: ${url.host}, dir: ${resolved.dir})`,
            );

            const reqWithBase = new Request(req.url, {
              method: req.method,
              headers: new Headers(req.headers),
              body: req.body,
            });
            reqWithBase.headers.set(HttpHeaders.BASE, "/");

            return pool.fetch(resolved.dir, resolved.config, reqWithBase);
          }
        }

        if (shouldBypass && isDocument) {
          logger.debug(`Shell bypassed: ${url.pathname}`);
        }
      }

      // 1. Handle CORS preflight (per-domain rule matched against the Origin)
      const preflightCors = resolveCors(req, corsRules);
      if (preflightCors) {
        const preflightResponse = handlePreflight(req, preflightCors);
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

    async onResponse(res, _app, req) {
      // Add CORS headers based on the per-domain rule matching the request
      // Origin. `req` is the request that produced this response (threaded by
      // the runtime); without it we cannot reflect a specific origin.
      if (req) {
        const cors = resolveCors(req, corsRules);
        if (cors) {
          return addCorsHeaders(req, res, cors);
        }
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
