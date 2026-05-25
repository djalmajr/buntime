/**
 * Runtime configuration
 *
 * Configuration is loaded from environment variables only.
 * Plugin manifests are auto-discovered from PLUGIN_DIRS.
 */
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getChildLogger } from "@buntime/shared/logger";
import { parseDurationToMs } from "@buntime/shared/utils/duration";
import { splitList } from "@buntime/shared/utils/string";
import {
  BodySizeLimits,
  DELAY_MS,
  IS_COMPILED,
  IS_DEV,
  NODE_ENV,
  PORT,
  VERSION,
} from "./constants";

const logger = getChildLogger("Config");

interface AuthDbRuntimeConfig {
  /** `local` keeps the DB self-contained; `sync` syncs to a Turso server primary. */
  mode: "local" | "sync";
  syncUrl?: string;
  syncAuthToken?: string;
  syncIntervalSeconds: number;
}

interface RuntimeConfig {
  apiKey?: string;
  authDb: AuthDbRuntimeConfig;
  bodySize: {
    default: number;
    max: number;
  };
  /**
   * Lifetime of the cpanel session cookie issued by `POST /api/admin/session`,
   * in milliseconds. Sourced from `RUNTIME_CPANEL_SESSION_TTL` (e.g. `24h`,
   * `30m`); default is 24h. See `parseDurationToMs` for accepted formats.
   */
  cpanelSessionTtlMs: number;
  delayMs: number;
  isCompiled: boolean;
  isDev: boolean;
  nodeEnv: string;
  pluginDirs: string[];
  poolSize: number;
  port: number;
  stateDir: string;
  version: string;
  workerDirs: string[];
}

const DEFAULT_CPANEL_SESSION_TTL = "24h";

// Pool size defaults by environment
const poolDefaults: Record<string, number> = {
  development: 10,
  production: 500,
  staging: 50,
  test: 5,
};

let _config: RuntimeConfig | null = null;

/**
 * Parse pool size from env var with validation
 * Returns fallback if value is invalid (NaN, non-positive)
 */
function parsePoolSize(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const parsed = parseInt(envValue, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warn(`Invalid RUNTIME_POOL_SIZE "${envValue}", using default: ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Expand directory paths from config
 * Handles colon-separated values from env vars (PATH style): "/path1:/path2"
 */
function expandDirs(dirs: string[], baseDir: string): string[] {
  return dirs.flatMap((dir) => {
    // Split by colon if env var contains multiple paths (PATH style)
    return splitList(dir, ":").map((p) => (isAbsolute(p) ? p : resolve(baseDir, p)));
  });
}

function readOptionalEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = Bun.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function selectWritableStateBase(baseDir: string, dirs: string[]): string {
  const preferred = dirs.find((dir) => !basename(resolve(dir)).startsWith("."));
  return preferred ?? dirs[0] ?? baseDir;
}

interface InitConfigOptions {
  /** Base directory for resolving relative paths (default: process.cwd()) */
  baseDir?: string;
  /** Worker directories (default: WORKER_DIRS env) */
  workerDirs?: string[];
}

/**
 * Initialize runtime configuration from environment variables
 */
export function initConfig(options: InitConfigOptions = {}): RuntimeConfig {
  const baseDir = options.baseDir ?? (IS_COMPILED ? dirname(process.execPath) : process.cwd());

  // Get workerDirs from env var (colon-separated, PATH style)
  // Relative paths are resolved against the base directory
  // RUNTIME_WORKER_DIRS="/data/.apps:/data/apps"
  const workerDirConfig =
    options.workerDirs ?? (Bun.env.RUNTIME_WORKER_DIRS ? [Bun.env.RUNTIME_WORKER_DIRS] : []);
  const workerDirs = expandDirs(workerDirConfig, baseDir);

  if (workerDirs.length === 0) {
    throw new Error("workerDirs is required: set RUNTIME_WORKER_DIRS env var");
  }

  // Warn about non-existent worker paths
  for (const dir of workerDirs) {
    if (!existsSync(dir)) {
      logger.warn(`Worker directory does not exist: ${dir}`);
    }
  }

  // Get pluginDirs from env var or default ["./plugins"]
  const pluginDirConfig = Bun.env.RUNTIME_PLUGIN_DIRS
    ? [Bun.env.RUNTIME_PLUGIN_DIRS]
    : ["./plugins"];
  const pluginDirs = expandDirs(pluginDirConfig, baseDir);
  const stateDirConfig = readOptionalEnv("RUNTIME_STATE_DIR");
  const stateDir = stateDirConfig
    ? resolve(baseDir, stateDirConfig)
    : join(selectWritableStateBase(baseDir, pluginDirs), ".buntime");

  // Get poolSize from env var or default by environment
  const envFallback = poolDefaults[NODE_ENV] ?? 100;
  const poolSize = parsePoolSize(Bun.env.RUNTIME_POOL_SIZE, envFallback);

  // ApiKeyStore backend config. Mode "local" is self-contained (single-pod);
  // "sync" requires a Turso server primary URL for embedded-replica multi-pod.
  const authDbMode = readOptionalEnv("RUNTIME_AUTH_DB_MODE") ?? "local";
  if (authDbMode !== "local" && authDbMode !== "sync") {
    throw new Error(`Invalid RUNTIME_AUTH_DB_MODE "${authDbMode}". Expected "local" or "sync".`);
  }
  const authDbSyncUrl = readOptionalEnv("RUNTIME_AUTH_DB_SYNC_URL");
  if (authDbMode === "sync" && !authDbSyncUrl) {
    throw new Error(
      "RUNTIME_AUTH_DB_MODE=sync requires RUNTIME_AUTH_DB_SYNC_URL " +
        "(libsql://… of the Turso server primary)",
    );
  }
  const authDbSyncIntervalRaw = readOptionalEnv("RUNTIME_AUTH_DB_SYNC_INTERVAL_SECONDS");
  const authDbSyncIntervalSeconds = authDbSyncIntervalRaw
    ? Math.max(0, Number.parseInt(authDbSyncIntervalRaw, 10) || 60)
    : 60;

  // Cpanel session cookie TTL. Parsed via parseDurationToMs ("24h" by default).
  // The cookie is HttpOnly + SameSite=Strict; expiry mirrors this value.
  const cpanelSessionTtlRaw =
    readOptionalEnv("RUNTIME_CPANEL_SESSION_TTL") ?? DEFAULT_CPANEL_SESSION_TTL;
  let cpanelSessionTtlMs: number;
  try {
    cpanelSessionTtlMs = parseDurationToMs(cpanelSessionTtlRaw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid RUNTIME_CPANEL_SESSION_TTL "${cpanelSessionTtlRaw}": ${reason}. ` +
        `Expected formats like "30m", "24h", "7d".`,
    );
  }
  if (cpanelSessionTtlMs <= 0) {
    throw new Error(
      `RUNTIME_CPANEL_SESSION_TTL "${cpanelSessionTtlRaw}" must be a positive duration.`,
    );
  }

  const config: RuntimeConfig = {
    apiKey: readOptionalEnv("RUNTIME_ROOT_KEY", "BUNTIME_ROOT_KEY"),
    authDb: {
      mode: authDbMode,
      syncAuthToken: readOptionalEnv("RUNTIME_AUTH_DB_SYNC_TOKEN"),
      syncIntervalSeconds: authDbSyncIntervalSeconds,
      syncUrl: authDbSyncUrl,
    },
    bodySize: {
      default: BodySizeLimits.DEFAULT,
      max: BodySizeLimits.MAX,
    },
    cpanelSessionTtlMs,
    delayMs: DELAY_MS,
    isCompiled: IS_COMPILED,
    isDev: IS_DEV,
    nodeEnv: NODE_ENV,
    pluginDirs,
    poolSize,
    port: PORT,
    stateDir,
    version: VERSION,
    workerDirs,
  };

  _config = config;
  return config;
}

/**
 * Get runtime configuration (must be initialized first)
 */
export function getConfig(): RuntimeConfig {
  if (!_config) throw new Error("Config not initialized. Call initConfig() first.");
  return _config;
}
