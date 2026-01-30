import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getChildLogger } from "@buntime/shared/logger";
import { maxSatisfying, rsort, valid } from "semver";

const logger = getChildLogger("getWorkerDir");

/**
 * Special version tag for workers without explicit versioning.
 * When no version is specified, "latest" takes precedence over semver versions.
 * Usage: workerDir/worker-name@latest/ or workerDir/worker-name/latest/
 */
const LATEST = "latest";

/**
 * Extract version from a flat folder name (e.g., "hello-api@1.0.0" -> "1.0.0")
 * Also supports "worker@latest" as a special version tag
 */
function extractVersionFromFlat(folderName: string, workerName: string): string | null {
  const prefix = `${workerName}@`;
  if (!folderName.startsWith(prefix)) return null;
  const version = folderName.slice(prefix.length);
  if (version === LATEST) return LATEST;
  return valid(version) ? version : null;
}

/**
 * Find versions in flat format (baseDir/worker-name@version/)
 */
function findFlatVersions(
  baseDir: string,
  workerName: string,
): { versions: string[]; dirs: Map<string, string> } {
  const versions: string[] = [];
  const dirs = new Map<string, string>();

  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const version = extractVersionFromFlat(entry.name, workerName);
      if (version) {
        versions.push(version);
        dirs.set(version, join(baseDir, entry.name));
      }
    }
  } catch {
    // Ignore errors
  }

  return { dirs, versions };
}

/**
 * Find versions in nested format (baseDir/worker-name/version/)
 * Also supports "worker-name/latest/" as a special version tag
 */
function findNestedVersions(
  baseDir: string,
  workerName: string,
): { versions: string[]; dirs: Map<string, string> } {
  const versions: string[] = [];
  const dirs = new Map<string, string>();
  const workerDir = join(baseDir, workerName);

  if (!existsSync(workerDir) || !statSync(workerDir).isDirectory()) {
    return { dirs, versions };
  }

  try {
    const entries = readdirSync(workerDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === LATEST || valid(entry.name)) {
        versions.push(entry.name);
        dirs.set(entry.name, join(workerDir, entry.name));
      }
    }
  } catch {
    // Ignore errors
  }

  return { dirs, versions };
}

/**
 * Creates a function to retrieve worker directories from multiple worker directory paths.
 * @param workerDirs - Array of worker directories to search for workers
 */
export function createWorkerResolver(workerDirs: string[]) {
  /**
   * Retrieves the filesystem path for a given worker name.
   *
   * Searches through all configured worker directories in order.
   * Supports two directory structures per directory:
   * - Flat: `workerDir/worker-name@1.0.0/` (checked first)
   * - Nested: `workerDir/worker-name/1.0.0/` (fallback)
   *
   * The worker name can be in the following formats:
   * - `worker-name` (prefers "latest" tag, otherwise highest semver)
   * - `worker-name@latest` (explicit latest tag)
   * - `worker-name@1` (highest version compatible with 1.x.x)
   * - `worker-name@1.4` (highest version compatible with 1.4.x)
   * - `worker-name@1.4.2` (exact version)
   *
   * Supports semantic versioning ranges like ^, ~, >=, etc.
   * Includes pre-release versions (-rc, -beta, -alpha).
   *
   * @param workerName - The name of the worker, optionally including a version range (e.g., "worker-name@1.4")
   * @returns The full filesystem path to the worker directory, or an empty string if not found
   */
  return function getWorkerDir(workerName: string): string {
    const [name, versionRange] = workerName.split("@");
    if (!name) return "";

    // Collect all versions from all directories
    const allVersions: string[] = [];
    const allDirs = new Map<string, string>();

    for (const workerDir of workerDirs) {
      // 1. Try flat format first (workerDir/worker-name@version/)
      const flat = findFlatVersions(workerDir, name);
      for (const version of flat.versions) {
        if (!allDirs.has(version)) {
          allVersions.push(version);
          allDirs.set(version, flat.dirs.get(version)!);
        }
      }

      // 2. Try nested format (workerDir/worker-name/version/)
      const nested = findNestedVersions(workerDir, name);
      for (const version of nested.versions) {
        if (!allDirs.has(version)) {
          allVersions.push(version);
          allDirs.set(version, nested.dirs.get(version)!);
        }
      }

      // 3. Try simple format (workerDir/worker-name/ without version subfolder)
      // Treat as "latest" if the folder has package.json or manifest.jsonc
      if (!allDirs.has(LATEST)) {
        const simpleDir = join(workerDir, name);
        if (existsSync(simpleDir) && statSync(simpleDir).isDirectory()) {
          const hasPackageJson = existsSync(join(simpleDir, "package.json"));
          const hasManifest =
            existsSync(join(simpleDir, "manifest.jsonc")) ||
            existsSync(join(simpleDir, "manifest.json"));
          if (hasPackageJson || hasManifest) {
            allVersions.push(LATEST);
            allDirs.set(LATEST, simpleDir);
          }
        }
      }
    }

    if (allVersions.length === 0) {
      return "";
    }

    // Handle "latest" tag explicitly
    if (versionRange === LATEST) {
      return allDirs.get(LATEST) ?? "";
    }

    const hasLatest = allDirs.has(LATEST);
    const semverVersions = allVersions.filter((v) => v !== LATEST);

    if (!versionRange) {
      // No version specified: prefer "latest" if exists, otherwise highest semver
      if (hasLatest) {
        return allDirs.get(LATEST)!;
      }
      if (semverVersions.length > 0) {
        const sorted = rsort(semverVersions);
        return allDirs.get(sorted[0]!) ?? "";
      }
      return "";
    }

    // Try to match version range against semver versions only
    const matched = maxSatisfying(semverVersions, versionRange, { includePrerelease: true });
    if (matched) {
      return allDirs.get(matched) ?? "";
    }

    logger.error(`No version satisfies range: ${versionRange}`);
    return "";
  };
}
