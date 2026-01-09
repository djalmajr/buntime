/**
 * Runtime configuration
 *
 * Combines environment variables with buntime.jsonc settings.
 * Must be initialized after loading buntime.jsonc via initConfig().
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { getChildLogger } from "@buntime/shared/logger";
import type { BuntimeConfig, HomepageConfig } from "@buntime/shared/types";
import { parseSizeToBytes } from "@buntime/shared/utils/size";
import { substituteEnvVars } from "@buntime/shared/utils/zod-helpers";
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
  homepage?: string | HomepageConfig;
  isCompiled: boolean;
  isDev: boolean;
  nodeEnv: string;
  pluginDirs: string[];
  poolSize: number;
  port: number;
  version: string;
  workspaces: string[];
}

// Default values
const defaults: Omit<RuntimeConfig, "pluginDirs" | "workspaces"> & {
  pluginDirs?: string[];
  workspaces?: string[];
} = {
  bodySize: {
    default: BodySizeLimits.DEFAULT,
    max: BodySizeLimits.MAX,
  },
  delayMs: DELAY_MS,
  homepage: undefined,
  isCompiled: IS_COMPILED,
  isDev: IS_DEV,
  nodeEnv: NODE_ENV,
  pluginDirs: undefined,
  poolSize: 100,
  port: PORT,
  version: VERSION,
  workspaces: undefined,
};

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
    logger.warn(`Invalid POOL_SIZE "${envValue}", using default: ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Expand directory paths from config
 * Handles comma-separated values from env vars: "${VAR}" where VAR="/path1,/path2"
 */
function expandDirs(dirs: string[], baseDir: string): string[] {
  return dirs.flatMap((dir) => {
    const expanded = substituteEnvVars(dir);
    // Split by comma if env var contains multiple paths
    return expanded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (isAbsolute(p) ? p : resolve(baseDir, p)));
  });
}

/**
 * Initialize runtime configuration from buntime.jsonc + env vars
 */
export function initConfig(buntimeConfig: BuntimeConfig, baseDir: string): RuntimeConfig {
  // Get workspaces: buntime.jsonc (array) > env var (comma-separated paths)
  // Relative paths are resolved against the config file directory
  // Supports comma-separated values in env vars: WORKSPACES_DIR="/app,/data"
  const workspaceDirs =
    buntimeConfig.workspaces ?? (Bun.env.WORKSPACES_DIR ? [Bun.env.WORKSPACES_DIR] : []);
  const workspaces = expandDirs(workspaceDirs, baseDir);

  if (workspaces.length === 0) {
    throw new Error("workspaces is required: set in buntime.jsonc or WORKSPACES_DIR env var");
  }

  // Warn about non-existent workspace paths
  for (const ws of workspaces) {
    if (!existsSync(ws)) {
      logger.warn(`Workspace path does not exist: ${ws}`);
    }
  }

  // Get pluginDirs: buntime.jsonc (array) > env var > default ["./plugins"]
  const pluginDirConfig =
    buntimeConfig.pluginDirs ?? (Bun.env.PLUGIN_DIRS ? [Bun.env.PLUGIN_DIRS] : ["./plugins"]);
  const pluginDirs = expandDirs(pluginDirConfig, baseDir);

  // Get poolSize: buntime.jsonc > env var > default by env
  const envFallback = poolDefaults[NODE_ENV] ?? 100;
  const poolSize = buntimeConfig.poolSize ?? parsePoolSize(Bun.env.POOL_SIZE, envFallback);

  // Get homepage: buntime.jsonc > env var (env var is string redirect format)
  const homepage: string | HomepageConfig | undefined =
    buntimeConfig.homepage ?? Bun.env.HOMEPAGE_APP;

  // Parse bodySize limits from config (with validation)
  let bodySizeDefault = BodySizeLimits.DEFAULT;
  let bodySizeMax = BodySizeLimits.MAX;

  if (buntimeConfig.bodySize) {
    if (buntimeConfig.bodySize.max !== undefined) {
      bodySizeMax = parseSizeToBytes(buntimeConfig.bodySize.max);
    }
    if (buntimeConfig.bodySize.default !== undefined) {
      bodySizeDefault = parseSizeToBytes(buntimeConfig.bodySize.default);
      // Ensure default doesn't exceed max
      if (bodySizeDefault > bodySizeMax) {
        logger.warn(
          `bodySize.default (${bodySizeDefault} bytes) exceeds bodySize.max (${bodySizeMax} bytes), capping to max`,
        );
        bodySizeDefault = bodySizeMax;
      }
    }
  }

  const config: RuntimeConfig = {
    ...defaults,
    bodySize: {
      default: bodySizeDefault,
      max: bodySizeMax,
    },
    homepage,
    pluginDirs,
    poolSize,
    workspaces,
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
