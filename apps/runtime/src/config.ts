/**
 * Runtime configuration
 *
 * Configuration is loaded from environment variables only.
 * Plugin manifests are auto-discovered from PLUGIN_DIRS.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { getChildLogger } from "@buntime/shared/logger";
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

interface RuntimeConfig {
  bodySize: {
    default: number;
    max: number;
  };
  delayMs: number;
  isCompiled: boolean;
  isDev: boolean;
  nodeEnv: string;
  pluginDirs: string[];
  poolSize: number;
  port: number;
  version: string;
  workerDirs: string[];
}

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
    return dir
      .split(":")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (isAbsolute(p) ? p : resolve(baseDir, p)));
  });
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

  // Get poolSize from env var or default by environment
  const envFallback = poolDefaults[NODE_ENV] ?? 100;
  const poolSize = parsePoolSize(Bun.env.RUNTIME_POOL_SIZE, envFallback);

  const config: RuntimeConfig = {
    bodySize: {
      default: BodySizeLimits.DEFAULT,
      max: BodySizeLimits.MAX,
    },
    delayMs: DELAY_MS,
    isCompiled: IS_COMPILED,
    isDev: IS_DEV,
    nodeEnv: NODE_ENV,
    pluginDirs,
    poolSize,
    port: PORT,
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
