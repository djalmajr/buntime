import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { maxSatisfying, rsort, valid } from "semver";

/**
 * Extract version from a flat folder name (e.g., "hello-api@1.0.0" -> "1.0.0")
 */
function extractVersionFromFlat(folderName: string, appName: string): string | null {
  const prefix = `${appName}@`;
  if (!folderName.startsWith(prefix)) return null;
  const version = folderName.slice(prefix.length);
  return valid(version) ? version : null;
}

/**
 * Find versions in flat format (appsDir/app-name@version/)
 */
function findFlatVersions(
  appsDir: string,
  appName: string,
): { versions: string[]; dirs: Map<string, string> } {
  const versions: string[] = [];
  const dirs = new Map<string, string>();

  try {
    const entries = readdirSync(appsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const version = extractVersionFromFlat(entry.name, appName);
      if (version) {
        versions.push(version);
        dirs.set(version, join(appsDir, entry.name));
      }
    }
  } catch {
    // Ignore errors
  }

  return { dirs, versions };
}

/**
 * Find versions in nested format (appsDir/app-name/version/)
 */
function findNestedVersions(
  appsDir: string,
  appName: string,
): { versions: string[]; dirs: Map<string, string> } {
  const versions: string[] = [];
  const dirs = new Map<string, string>();
  const appDir = join(appsDir, appName);

  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    return { dirs, versions };
  }

  try {
    const entries = readdirSync(appDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (valid(entry.name)) {
        versions.push(entry.name);
        dirs.set(entry.name, join(appDir, entry.name));
      }
    }
  } catch {
    // Ignore errors
  }

  return { dirs, versions };
}

/**
 * Creates a function to retrieve app directories from multiple base paths.
 * @param appsDirs - Array of directories to search for apps
 */
export function createAppResolver(appsDirs: string[]) {
  /**
   * Retrieves the filesystem path for a given app name.
   *
   * Searches through all configured app directories in order.
   * Supports two directory structures per directory:
   * - Flat: `appsDir/app-name@1.0.0/` (checked first)
   * - Nested: `appsDir/app-name/1.0.0/` (fallback)
   *
   * The app name can be in the following formats:
   * - `app-name` (highest version)
   * - `app-name@1` (highest version compatible with 1.x.x)
   * - `app-name@1.4` (highest version compatible with 1.4.x)
   * - `app-name@1.4.2` (exact version)
   *
   * Supports semantic versioning ranges like ^, ~, >=, etc.
   * Includes pre-release versions (-rc, -beta, -alpha).
   *
   * @param appName - The name of the app, optionally including a version range (e.g., "app-name@1.4")
   * @returns The full filesystem path to the app directory, or an empty string if not found
   */
  return function getAppDir(appName: string): string {
    const [name, versionRange] = appName.split("@");
    if (!name) return "";

    // Collect all versions from all directories
    const allVersions: string[] = [];
    const allDirs = new Map<string, string>();

    for (const appsDir of appsDirs) {
      // 1. Try flat format first (appsDir/app-name@version/)
      const flat = findFlatVersions(appsDir, name);
      for (const version of flat.versions) {
        if (!allDirs.has(version)) {
          allVersions.push(version);
          allDirs.set(version, flat.dirs.get(version)!);
        }
      }

      // 2. Try nested format (appsDir/app-name/version/)
      const nested = findNestedVersions(appsDir, name);
      for (const version of nested.versions) {
        if (!allDirs.has(version)) {
          allVersions.push(version);
          allDirs.set(version, nested.dirs.get(version)!);
        }
      }
    }

    if (allVersions.length === 0) {
      return "";
    }

    if (!versionRange) {
      // No version specified: return highest version
      const sorted = rsort(allVersions);
      return allDirs.get(sorted[0]!) ?? "";
    }

    // Try to match version range
    const matched = maxSatisfying(allVersions, versionRange, { includePrerelease: true });
    if (matched) {
      return allDirs.get(matched) ?? "";
    }

    console.error(`[getAppDir] No version satisfies range: ${versionRange}`);
    return "";
  };
}
