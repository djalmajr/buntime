/**
 * @module
 * Path policies for the generic `<FileBrowser>` mount points.
 *
 * The runtime mounts the same file-browser routes twice — once for workers and
 * once for plugins — but the two surfaces have different layout constraints:
 *
 * - **Workers** live in `{name}/{version}/` (or flat `{name}@{version}/`) and
 *   the runtime's resolver depends on that shape. Uploads must target a
 *   version folder; moves are forbidden across the app/version boundary.
 * - **Plugins** live in flat `{name}/` folders (no versioning); the loader
 *   reads `manifest.yaml` at the plugin root. Anything below the plugin root
 *   is free-form.
 *
 * A `PathPolicy` captures these differences so a single `DirInfo` class and a
 * single `createFsRoutes` factory can serve both surfaces.
 */

import { valid } from "semver";

/** Result of parsing a relative path against a particular layout. */
export interface ParsedPath {
  /** First-level folder name, or null if the path is empty. */
  appName: string | null;
  /** Depth (number of slash-separated segments). 0 = root. */
  depth: number;
  /**
   * Path of the "unit" that owns a manifest (version folder for workers,
   * plugin folder for plugins), relative to the mount root. `null` when the
   * current path is above any unit root.
   */
  unitRoot: string | null;
  /** Semver version, when applicable. */
  version: string | null;
}

/**
 * A PathPolicy decides whether a path:
 *  - parses into a recognisable layout (`parse`)
 *  - is a valid destination for uploads or moves (`canWriteAt`)
 *  - corresponds to a "unit" whose manifest the lister should validate
 *    (`isUnitRoot`)
 */
export interface PathPolicy {
  /** Human-readable name (debug/log). */
  name: string;
  parse(relativePath: string | undefined | null): ParsedPath;
  /** True if uploads may target this path (the unit root OR anywhere inside it). */
  canWriteAt(relativePath: string): boolean;
  /**
   * True if this path is STRICTLY inside a unit (not the unit root itself).
   * Used by `move()` so the version/plugin folder itself cannot be relocated.
   */
  isInsideUnit(relativePath: string): boolean;
  /** True if this path is the root of a unit with a manifest. */
  isUnitRoot(relativePath: string): boolean;
}

// ---------------------------------------------------------------------------
// Helpers shared between policies
// ---------------------------------------------------------------------------

function isValidVersion(version: string): boolean {
  return valid(version) !== null || version === "latest";
}

/** Parse `app@version` flat folder; null if it's not in that shape. */
function parseFlatFolder(folderName: string): { name: string; version: string } | null {
  const atIndex = folderName.lastIndexOf("@");
  if (atIndex === -1) return null;

  const name = folderName.slice(0, atIndex);
  const version = folderName.slice(atIndex + 1);

  if (!name || !isValidVersion(version)) return null;
  return { name, version };
}

const EMPTY: ParsedPath = {
  appName: null,
  depth: 0,
  unitRoot: null,
  version: null,
};

function splitParts(path: string | undefined | null): string[] {
  if (!path || path.trim() === "") return [];
  return path.split("/").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Workers policy (semver-aware)
// ---------------------------------------------------------------------------

/**
 * Workers policy — accepts both `{name}/{version}/...` (nested) and
 * `{name}@{version}/...` (flat). Uploads/moves must land inside a version
 * folder. The version folder itself is the "unit" for manifest detection.
 */
export const workersPathPolicy: PathPolicy = {
  name: "workers",

  parse(relativePath) {
    const parts = splitParts(relativePath);
    if (parts.length === 0) return EMPTY;

    const firstPart = parts[0]!;

    // Flat: app@version/...
    const flat = parseFlatFolder(firstPart);
    if (flat) {
      return {
        appName: flat.name,
        depth: parts.length + 1, // flat folder counts as app+version
        unitRoot: firstPart,
        version: flat.version,
      };
    }

    // Nested: app/...
    const appName = firstPart;
    if (parts.length === 1) {
      return { appName, depth: 1, unitRoot: null, version: null };
    }

    const secondPart = parts[1]!;
    if (isValidVersion(secondPart)) {
      return {
        appName,
        depth: parts.length,
        unitRoot: `${appName}/${secondPart}`,
        version: secondPart,
      };
    }

    return { appName, depth: parts.length, unitRoot: null, version: null };
  },

  canWriteAt(relativePath) {
    return workersPathPolicy.parse(relativePath).unitRoot !== null;
  },

  isInsideUnit(relativePath) {
    const parsed = workersPathPolicy.parse(relativePath);
    if (!parsed.unitRoot) return false;
    // Flat: flat folder itself reports depth=2 (policy bumps), inside is 3+.
    // Nested: version folder is depth=2, inside is depth=3+.
    return parsed.depth >= 3;
  },

  isUnitRoot(relativePath) {
    const parsed = workersPathPolicy.parse(relativePath);
    if (!parsed.unitRoot) return false;
    return parsed.depth === 2;
  },
};

// ---------------------------------------------------------------------------
// Plugins policy (free-form)
// ---------------------------------------------------------------------------

/**
 * Plugins policy — plugins live as flat `{name}/` folders (no versioning).
 * The plugin root is the "unit" with a manifest. Anything below it is
 * free-form: uploads, moves, mkdir all allowed.
 */
export const pluginsPathPolicy: PathPolicy = {
  name: "plugins",

  parse(relativePath) {
    const parts = splitParts(relativePath);
    if (parts.length === 0) return EMPTY;

    const appName = parts[0]!;
    return {
      appName,
      depth: parts.length,
      unitRoot: appName,
      version: null,
    };
  },

  canWriteAt(relativePath) {
    // Allow writes anywhere at or under a plugin folder.
    return pluginsPathPolicy.parse(relativePath).depth >= 1;
  },

  isInsideUnit(relativePath) {
    // Strictly INSIDE a plugin folder, not the plugin folder itself.
    return pluginsPathPolicy.parse(relativePath).depth >= 2;
  },

  isUnitRoot(relativePath) {
    return pluginsPathPolicy.parse(relativePath).depth === 1;
  },
};

// ---------------------------------------------------------------------------
// Back-compat aliases (used by existing call sites that referenced the
// deployment-path helpers directly).
// ---------------------------------------------------------------------------

export type DeploymentPathInfo = {
  appName: string | null;
  depth: number;
  format: "flat" | "nested" | null;
  isInsideVersion: boolean;
  version: string | null;
};

/**
 * Legacy wrapper preserved for the migrated test suite. Calls
 * `workersPathPolicy.parse` and reshapes the result to the original API.
 */
export function parseDeploymentPath(path: string | undefined | null): DeploymentPathInfo {
  const parsed = workersPathPolicy.parse(path);
  // Detect format: if first segment matches `<name>@<version>`, it's flat.
  const parts = splitParts(path);
  const firstPart = parts[0];
  const flat = firstPart ? parseFlatFolder(firstPart) : null;
  const format: "flat" | "nested" | null = parts.length === 0 ? null : flat ? "flat" : "nested";

  return {
    appName: parsed.appName,
    depth: parsed.depth,
    format,
    isInsideVersion: parsed.unitRoot !== null,
    version: parsed.version,
  };
}

/** Legacy wrapper — true when the path is inside a worker version folder. */
export function isValidUploadDestination(path: string | undefined | null): boolean {
  return workersPathPolicy.canWriteAt(path ?? "");
}

/** Legacy wrapper. */
export function extractAppName(path: string | undefined | null): string | null {
  return workersPathPolicy.parse(path).appName;
}
