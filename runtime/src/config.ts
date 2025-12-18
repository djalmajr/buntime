/**
 * Runtime configuration
 *
 * Combines environment variables with buntime.jsonc settings.
 * Must be initialized after loading buntime.jsonc via initConfig().
 */
import { isAbsolute, resolve } from "node:path";
import type { BuntimeConfig, HomepageConfig } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils/zod-helpers";
import { DELAY_MS, IS_COMPILED, IS_DEV, NODE_ENV, PORT, VERSION } from "./constants";

interface RuntimeConfig {
  delayMs: number;
  homepage?: string | HomepageConfig;
  isCompiled: boolean;
  isDev: boolean;
  nodeEnv: string;
  poolSize: number;
  port: number;
  version: string;
  workspaces: string[];
}

// Default values
const defaults: Omit<RuntimeConfig, "workspaces"> & { workspaces?: string[] } = {
  delayMs: DELAY_MS,
  homepage: undefined,
  isCompiled: IS_COMPILED,
  isDev: IS_DEV,
  nodeEnv: NODE_ENV,
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
 * Resolve a path relative to a base directory
 * If path is absolute, returns as-is. If relative, resolves against baseDir.
 */
function resolvePath(path: string, baseDir: string): string {
  const expanded = substituteEnvVars(path);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

/**
 * Parse WORKSPACES_DIR env var (supports comma-separated paths)
 * @example "../../buntime-apps" or "/dir1,/dir2,../dir3"
 */
function parseWorkspacesEnv(envValue: string, baseDir: string): string[] {
  return envValue
    .split(",")
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => resolvePath(dir, baseDir));
}

/**
 * Initialize runtime configuration from buntime.jsonc + env vars
 */
export function initConfig(buntimeConfig: BuntimeConfig, baseDir: string): RuntimeConfig {
  // Get workspaces: buntime.jsonc (array) > env var (comma-separated paths)
  // Relative paths are resolved against the config file directory
  const workspaces = buntimeConfig.workspaces
    ? buntimeConfig.workspaces.map((dir) => resolvePath(dir, baseDir))
    : Bun.env.WORKSPACES_DIR
      ? parseWorkspacesEnv(Bun.env.WORKSPACES_DIR, baseDir)
      : [];

  if (workspaces.length === 0) {
    throw new Error("workspaces is required: set in buntime.jsonc or WORKSPACES_DIR env var");
  }

  // Get poolSize: buntime.jsonc > env var > default by env
  const poolSize =
    buntimeConfig.poolSize ??
    (Bun.env.POOL_SIZE ? parseInt(Bun.env.POOL_SIZE, 10) : (poolDefaults[NODE_ENV] ?? 100));

  // Get homepage: buntime.jsonc > env var (env var is string redirect format)
  const homepage: string | HomepageConfig | undefined =
    buntimeConfig.homepage ?? Bun.env.HOMEPAGE_APP;

  const config: RuntimeConfig = {
    ...defaults,
    homepage,
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
  if (!_config) {
    throw new Error("Config not initialized. Call initConfig() first.");
  }
  return _config;
}

// Re-export constants that don't change
export { DELAY_MS, IS_COMPILED, IS_DEV, NODE_ENV, PORT, VERSION } from "./constants";
