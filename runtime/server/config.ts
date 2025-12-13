/**
 * Runtime configuration
 *
 * Combines environment variables with buntime.jsonc settings.
 * Must be initialized after loading buntime.jsonc via initConfig().
 */
import { isAbsolute, resolve } from "node:path";
import type { BuntimeConfig } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils/zod-helpers";
import { DELAY_MS, IS_COMPILED, IS_DEV, NODE_ENV, PORT, VERSION } from "./constants";

interface RuntimeConfig {
  appsDirs: string[];
  delayMs: number;
  isCompiled: boolean;
  isDev: boolean;
  nodeEnv: string;
  poolSize: number;
  port: number;
  shell?: string;
  version: string;
}

// Default values
const defaults: Omit<RuntimeConfig, "appsDirs"> & { appsDirs?: string[] } = {
  appsDirs: undefined,
  delayMs: DELAY_MS,
  isCompiled: IS_COMPILED,
  isDev: IS_DEV,
  nodeEnv: NODE_ENV,
  poolSize: 100,
  port: PORT,
  shell: undefined,
  version: VERSION,
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
 * Resolve a path relative to a base directory
 * If path is absolute, returns as-is. If relative, resolves against baseDir.
 */
function resolvePath(path: string, baseDir: string): string {
  const expanded = substituteEnvVars(path);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

/**
 * Initialize runtime configuration from buntime.jsonc + env vars
 */
export function initConfig(buntimeConfig: BuntimeConfig, baseDir: string): RuntimeConfig {
  // Get appsDir: buntime.jsonc (array) > env var (single path fallback)
  // Relative paths are resolved against the config file directory
  const appsDirs = buntimeConfig.appsDir
    ? buntimeConfig.appsDir.map((dir) => resolvePath(dir, baseDir))
    : Bun.env.APPS_DIR
      ? [resolvePath(Bun.env.APPS_DIR, baseDir)]
      : [];

  if (appsDirs.length === 0) {
    throw new Error("appsDir is required: set in buntime.jsonc or APPS_DIR env var");
  }

  // Get poolSize: buntime.jsonc > env var > default by env
  const poolSize =
    buntimeConfig.poolSize ??
    (Bun.env.POOL_SIZE ? parseInt(Bun.env.POOL_SIZE, 10) : (poolDefaults[NODE_ENV] ?? 100));

  // Get shell: buntime.jsonc > env var
  const shell = buntimeConfig.shell ?? Bun.env.APP_SHELL;

  _config = {
    ...defaults,
    appsDirs,
    poolSize,
    shell,
  };

  return _config;
}

/**
 * Get runtime configuration (must be initialized first)
 */
export function getConfig(): RuntimeConfig {
  if (!_config) {
    throw new Error("Config not initialized. Call initConfig() first.");
  }
  return _config;
}

// Re-export constants that don't change
export { DELAY_MS, IS_COMPILED, IS_DEV, NODE_ENV, PORT, VERSION } from "./constants";
