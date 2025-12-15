import { valid } from "semver";

/**
 * Information about a deployment path
 */
export interface DeploymentPathInfo {
  /** The app name without version (e.g., "hello-api") */
  appName: string | null;
  /**
   * Depth level:
   * - 0: root (no path)
   * - 1: inside app folder (nested) or at flat versioned folder
   * - 2: inside version folder (nested) or inside flat versioned folder
   * - 3+: deeper inside version
   */
  depth: number;
  /** Format detected: "flat" (app@version), "nested" (app/version), or null */
  format: "flat" | "nested" | null;
  /** Whether uploads/file operations are allowed (inside a version folder) */
  isInsideVersion: boolean;
  /** The version string if detected (e.g., "1.0.0") */
  version: string | null;
}

/**
 * Check if a version string is valid (semver or "latest" tag)
 */
function isValidVersion(version: string): boolean {
  return valid(version) !== null || version === "latest";
}

/**
 * Extract version from a flat folder name (e.g., "hello-api@1.0.0" -> { name: "hello-api", version: "1.0.0" })
 * Also supports "latest" as a special version tag.
 */
function parseFlatFolder(folderName: string): { name: string; version: string } | null {
  const atIndex = folderName.lastIndexOf("@");
  if (atIndex === -1) return null;

  const name = folderName.slice(0, atIndex);
  const version = folderName.slice(atIndex + 1);

  if (!name || !isValidVersion(version)) return null;

  return { name, version };
}

/**
 * Parse a deployment path and return information about it.
 *
 * Supports two directory structures:
 * - Flat: `app-name@1.0.0/files...`
 * - Nested: `app-name/1.0.0/files...`
 *
 * @param path - The deployment path (e.g., "hello-api@1.0.0/src" or "hello-api/1.0.0/src")
 * @returns Information about the path including format, depth, and whether uploads are allowed
 */
export function parseDeploymentPath(path: string | undefined | null): DeploymentPathInfo {
  const emptyResult: DeploymentPathInfo = {
    appName: null,
    depth: 0,
    format: null,
    isInsideVersion: false,
    version: null,
  };

  if (!path || path.trim() === "") {
    return emptyResult;
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    return emptyResult;
  }

  const firstPart = parts[0]!;

  // Check if first part is flat format (app@version)
  const flatParsed = parseFlatFolder(firstPart);
  if (flatParsed) {
    // Flat format: app@version/...
    // depth 1 = at the flat folder itself (hello-api@1.0.0)
    // depth 2+ = inside the flat folder (hello-api@1.0.0/src)
    return {
      appName: flatParsed.name,
      depth: parts.length + 1, // +1 because flat folder counts as app+version
      format: "flat",
      isInsideVersion: true, // Always inside version for flat format
      version: flatParsed.version,
    };
  }

  // Nested format: app/version/...
  const appName = firstPart;

  if (parts.length === 1) {
    // Just the app folder (hello-api)
    return {
      appName,
      depth: 1,
      format: "nested",
      isInsideVersion: false,
      version: null,
    };
  }

  const secondPart = parts[1]!;

  if (isValidVersion(secondPart)) {
    // Nested format with valid version
    return {
      appName,
      depth: parts.length,
      format: "nested",
      isInsideVersion: true,
      version: secondPart,
    };
  }

  // Second part is not a valid version - treat as nested without version
  return {
    appName,
    depth: parts.length,
    format: "nested",
    isInsideVersion: false,
    version: null,
  };
}

/**
 * Check if a path represents a valid destination for file operations.
 * Valid destinations are inside a version folder (flat or nested).
 *
 * @param path - The deployment path to check
 * @returns true if the path is inside a version folder
 */
export function isValidUploadDestination(path: string | undefined | null): boolean {
  return parseDeploymentPath(path).isInsideVersion;
}

/**
 * Extract the app name from a path, handling flat format.
 * For flat format (app@version), returns just the app name without version.
 * For nested format, returns the first path segment.
 *
 * @param path - The deployment path
 * @returns The app name or null if path is empty
 */
export function extractAppName(path: string | undefined | null): string | null {
  return parseDeploymentPath(path).appName;
}
