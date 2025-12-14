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
 * Extract version from a flat folder name (e.g., "hello-api@1.0.0" -> { name: "hello-api", version: "1.0.0" })
 */
function parseFlatFolder(folderName: string): { name: string; version: string } | null {
  const atIndex = folderName.lastIndexOf("@");
  if (atIndex === -1) return null;

  const name = folderName.slice(0, atIndex);
  const version = folderName.slice(atIndex + 1);

  if (!name || !valid(version)) return null;

  return { name, version };
}

/**
 * Parse a deployment path and return information about it.
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
    return {
      appName: flatParsed.name,
      depth: parts.length + 1,
      format: "flat",
      isInsideVersion: true,
      version: flatParsed.version,
    };
  }

  // Nested format: app/version/...
  const appName = firstPart;

  if (parts.length === 1) {
    return {
      appName,
      depth: 1,
      format: "nested",
      isInsideVersion: false,
      version: null,
    };
  }

  const secondPart = parts[1]!;
  const isValidVersion = valid(secondPart) !== null;

  if (isValidVersion) {
    return {
      appName,
      depth: parts.length,
      format: "nested",
      isInsideVersion: true,
      version: secondPart,
    };
  }

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
 */
export function isValidUploadDestination(path: string | undefined | null): boolean {
  return parseDeploymentPath(path).isInsideVersion;
}
