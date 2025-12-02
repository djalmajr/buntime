import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { maxSatisfying, rsort, valid } from "semver";
import { APPS_DIR } from "~/constants";

/**
 * Retrieves the filesystem path for a given app name.
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
 * Only directories following semantic versioning (e.g., 1.0.0, 2.1.3) are considered.
 *
 * @param appName - The name of the app, optionally including a version range (e.g., "app-name@1.4")
 * @returns The full filesystem path to the app directory, or an empty string if not found
 */
export function getAppDir(appName: string): string {
  const [name, versionRange] = appName.split("@");

  // Get available versions
  const appDir = join(APPS_DIR, name ?? "");
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    return "";
  }

  try {
    const entries = readdirSync(appDir, { withFileTypes: true });
    const versions = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => valid(name) !== null); // Only valid semver directories

    if (versions.length === 0) {
      return "";
    }

    // If no version specified, return the highest version
    if (!versionRange) {
      const sortedVersions = rsort(versions);
      return join(appDir, sortedVersions[0] ?? "");
    }

    // Try to find a matching version using semver range
    const matchedVersion = maxSatisfying(versions, versionRange, {
      includePrerelease: true,
    });

    if (matchedVersion) {
      return join(appDir, matchedVersion);
    }

    console.error(`[getAppDir] No version satisfies range: ${versionRange}`);
    return "";
  } catch (err) {
    console.error(`[getAppDir] Error reading directory ${appDir}:`, err);
    return "";
  }
}
