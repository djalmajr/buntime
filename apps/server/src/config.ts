/**
 * Runtime configuration
 *
 * Combines environment variables with buntime.jsonc settings.
 * Must be initialized after loading buntime.jsonc via initConfig().
 */
import type { BuntimeConfig } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils";
import { DELAY_MS, IS_COMPILED, IS_DEV, NODE_ENV, PORT, VERSION } from "./constants";

interface RuntimeConfig {
  appsDir: string;
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
const defaults: Omit<RuntimeConfig, "appsDir"> & { appsDir?: string } = {
  appsDir: undefined,
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
 * Initialize runtime configuration from buntime.jsonc + env vars
 */
export function initConfig(buntimeConfig: BuntimeConfig): RuntimeConfig {
  // Get appsDir: buntime.jsonc > env var
  let appsDir = buntimeConfig.appsDir
    ? substituteEnvVars(buntimeConfig.appsDir)
    : Bun.env.APPS_DIR;

  if (!appsDir) {
    throw new Error("appsDir is required: set in buntime.jsonc or APPS_DIR env var");
  }

  // Get poolSize: buntime.jsonc > env var > default by env
  const poolSize =
    buntimeConfig.poolSize ??
    (Bun.env.POOL_SIZE ? parseInt(Bun.env.POOL_SIZE, 10) : poolDefaults[NODE_ENV] ?? 100);

  // Get shell: buntime.jsonc > env var
  const shell = buntimeConfig.shell ?? Bun.env.APP_SHELL;

  _config = {
    ...defaults,
    appsDir,
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
