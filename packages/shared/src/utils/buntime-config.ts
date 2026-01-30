import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Base config interface with common fields across manifest.jsonc files
 */
export interface ManifestConfig {
  enabled?: boolean;
  entrypoint?: string;
  [key: string]: unknown;
}

/**
 * Parse JSONC (JSON with comments) by stripping comments
 */
export function parseJsonc(content: string): unknown {
  // Remove single-line comments (but not URLs with //)
  const withoutSingleLine = content.replace(/(?<![:\\"'])\/\/(?![:\\"']).*/gm, "");
  // Remove multi-line comments
  const withoutComments = withoutSingleLine.replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(withoutComments);
}

const MANIFEST_FILES = ["manifest.jsonc", "manifest.json"] as const;

/**
 * Load manifest config from directory (sync version for build scripts)
 *
 * Tries in order:
 * 1. manifest.jsonc
 * 2. manifest.json
 *
 * @returns undefined if no config found, throws on parse errors
 */
export function loadManifestConfigSync(dir: string): ManifestConfig | undefined {
  for (const filename of MANIFEST_FILES) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      return filename.endsWith(".jsonc")
        ? (parseJsonc(content) as ManifestConfig)
        : (JSON.parse(content) as ManifestConfig);
    }
  }

  return undefined;
}

/**
 * Load manifest config from directory (async version for runtime)
 *
 * Tries in order:
 * 1. manifest.jsonc
 * 2. manifest.json
 *
 * Note: Uses file.text() + parseJsonc() instead of import() to avoid Bun's import cache
 *
 * @returns undefined if no config found, throws on parse errors
 */
export async function loadManifestConfig(dir: string): Promise<ManifestConfig | undefined> {
  for (const filename of MANIFEST_FILES) {
    const filePath = join(dir, filename);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const content = await file.text();
      return filename.endsWith(".jsonc")
        ? (parseJsonc(content) as ManifestConfig)
        : (JSON.parse(content) as ManifestConfig);
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
