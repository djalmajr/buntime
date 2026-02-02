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
