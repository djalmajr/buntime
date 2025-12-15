import { valid } from "semver";

/**
 * Information about a deployment path
 *
 * Path structure with virtual root folders:
 * - "" -> root (shows all appsDirs)
 * - "rootName" -> inside virtual root folder
 * - "rootName/app@version" -> flat format, inside version
 * - "rootName/app" -> nested format, inside app folder
 * - "rootName/app/version" -> nested format, inside version
 */
export interface DeploymentPathInfo {
  /** The app name without version (e.g., "hello-api") */
  appName: string | null;
  /**
   * Depth level:
   * - 0: root (no path)
   * - 1: inside virtual root folder (rootName only)
   * - 2: inside app folder (nested) or inside flat versioned folder
   * - 3: inside version folder (nested) or deeper inside flat version
   * - 4+: deeper levels
   */
  depth: number;
  /** Format detected: "flat" (app@version), "nested" (app/version), or null */
  format: "flat" | "nested" | null;
  /** Whether uploads/file operations are allowed (inside a version folder) */
  isInsideVersion: boolean;
  /** The virtual root folder name (e.g., "buntime-apps", "examples") */
  rootName: string | null;
  /** The version string if detected (e.g., "1.0.0") */
  version: string | null;
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

  // Accept semver versions or "latest" tag
  if (!name || (!valid(version) && version !== "latest")) return null;

  return { name, version };
}

/**
 * Parse a deployment path and return information about it.
 * Accounts for virtual root folder prefix (e.g., "buntime-apps/app@version").
 */
export function parseDeploymentPath(path: string | undefined | null): DeploymentPathInfo {
  const emptyResult: DeploymentPathInfo = {
    appName: null,
    depth: 0,
    format: null,
    isInsideVersion: false,
    rootName: null,
    version: null,
  };

  if (!path || path.trim() === "") {
    return emptyResult;
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    return emptyResult;
  }

  // First part is always the virtual root folder name
  const rootName = parts[0]!;

  // depth 1 = inside virtual root folder only
  if (parts.length === 1) {
    return {
      appName: null,
      depth: 1,
      format: null,
      isInsideVersion: false,
      rootName,
      version: null,
    };
  }

  // Second part is either app@version (flat) or app name (nested)
  const secondPart = parts[1]!;

  // Check if second part is flat format (app@version)
  const flatParsed = parseFlatFolder(secondPart);
  if (flatParsed) {
    return {
      appName: flatParsed.name,
      depth: parts.length,
      format: "flat",
      isInsideVersion: true, // inside flat version folder
      rootName,
      version: flatParsed.version,
    };
  }

  // Nested format: rootName/app/version/...
  const appName = secondPart;

  // depth 2 = inside app folder (nested format)
  if (parts.length === 2) {
    return {
      appName,
      depth: 2,
      format: "nested",
      isInsideVersion: false,
      rootName,
      version: null,
    };
  }

  // Third part should be version (nested format)
  const thirdPart = parts[2]!;
  // Accept semver versions or "latest" tag
  const isVersionValid = valid(thirdPart) !== null || thirdPart === "latest";

  if (isVersionValid) {
    return {
      appName,
      depth: parts.length,
      format: "nested",
      isInsideVersion: true, // inside nested version folder
      rootName,
      version: thirdPart,
    };
  }

  // Not a valid version - could be a subfolder inside app
  return {
    appName,
    depth: parts.length,
    format: "nested",
    isInsideVersion: false,
    rootName,
    version: null,
  };
}

/**
 * Check if a path represents a valid destination for file operations.
 */
export function isValidUploadDestination(path: string | undefined | null): boolean {
  return parseDeploymentPath(path).isInsideVersion;
}
