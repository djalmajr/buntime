import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Base config interface with common fields across manifest.yaml files
 */
export interface ManifestConfig {
  enabled?: boolean;
  entrypoint?: string;
  [key: string]: unknown;
}

const MANIFEST_FILES = ["manifest.yaml", "manifest.yml"] as const;

/**
 * Parse .env file content into key-value pairs
 * Supports: comments (#), empty lines, quoted values ("" or '')
 */
function parseEnvContent(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Load .env file from directory (async version for runtime)
 *
 * @returns Empty object if no .env found
 */
export async function loadEnvFile(dir: string): Promise<Record<string, string>> {
  const envPath = join(dir, ".env");
  const file = Bun.file(envPath);

  if (await file.exists()) {
    const content = await file.text();
    return parseEnvContent(content);
  }

  return {};
}

/**
 * Load .env file from directory (sync version for build scripts)
 *
 * @returns Empty object if no .env found
 */
export function loadEnvFileSync(dir: string): Record<string, string> {
  const envPath = join(dir, ".env");

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    return parseEnvContent(content);
  }

  return {};
}

/**
 * Load manifest config from directory (sync version for build scripts)
 *
 * Tries in order:
 * 1. manifest.yaml
 * 2. manifest.yml
 *
 * @returns undefined if no config found, throws on parse errors
 */
export function loadManifestConfigSync(dir: string): ManifestConfig | undefined {
  for (const filename of MANIFEST_FILES) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      return Bun.YAML.parse(content) as ManifestConfig;
    }
  }

  return undefined;
}

/**
 * Load manifest config from directory (async version for runtime)
 *
 * Tries in order:
 * 1. manifest.yaml
 * 2. manifest.yml
 *
 * @returns undefined if no config found, throws on parse errors
 */
export async function loadManifestConfig(dir: string): Promise<ManifestConfig | undefined> {
  for (const filename of MANIFEST_FILES) {
    const filePath = join(dir, filename);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const content = await file.text();
      return Bun.YAML.parse(content) as ManifestConfig;
    }
  }

  return undefined;
}

/**
 * Check if plugin/app is enabled
 *
 * @returns true if enabled or no config exists (enabled by default)
 */
export function isEnabledSync(dir: string): boolean {
  try {
    const config = loadManifestConfigSync(dir);
    return config?.enabled !== false;
  } catch {
    return true; // On error, assume enabled
  }
}

/**
 * Check if plugin/app is enabled (async version)
 *
 * @returns true if enabled or no config exists (enabled by default)
 */
export async function isEnabled(dir: string): Promise<boolean> {
  try {
    const config = await loadManifestConfig(dir);
    return config?.enabled !== false;
  } catch {
    return true; // On error, assume enabled
  }
}
