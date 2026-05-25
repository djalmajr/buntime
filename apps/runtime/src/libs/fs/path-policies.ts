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
 * Both policies are **scope-aware**: if the first segment starts with `@`,
 * the next segment is treated as the second half of the unit name (npm-style
 * scoped packages: `@scope/name` is ONE name, not two folders). All depth
 * and unit-root math then shifts by one segment for the scoped case.
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

/** True if the first segment looks like an npm scope (`@something`). */
function hasScopePrefix(parts: string[]): boolean {
  return parts.length >= 1 && parts[0]!.startsWith("@");
}

/** Strip leading/trailing slashes for canonical comparison. */
function cleanPath(path: string | undefined | null): string {
  return (path ?? "").replace(/^\/+|\/+$/g, "");
}

// ---------------------------------------------------------------------------
// Workers policy (semver-aware, scope-aware)
// ---------------------------------------------------------------------------

/**
 * Workers policy — accepts both `{name}/{version}/...` (nested) and
 * `{name}@{version}/...` (flat). Scoped variants `@scope/name/{version}/...`
 * and `@scope/name@{version}/...` shift the "name index" by one segment.
 * Uploads/moves must land inside a version folder. The version folder itself
 * is the "unit" for manifest detection.
 */
export const workersPathPolicy: PathPolicy = {
  name: "workers",

  parse(relativePath) {
    const parts = splitParts(relativePath);
    if (parts.length === 0) return EMPTY;

    const scoped = hasScopePrefix(parts);

    // Just the @scope folder, no name yet.
    if (scoped && parts.length === 1) {
      return { appName: null, depth: 1, unitRoot: null, version: null };
    }

    const nameIdx = scoped ? 1 : 0;
    const nameSeg = parts[nameIdx]!;
    const fullName = scoped ? `${parts[0]}/${nameSeg}` : nameSeg;

    // Flat form: `<name>@<version>` at the name slot.
    const flat = parseFlatFolder(nameSeg);
    if (flat) {
      const unitRoot = scoped ? `${parts[0]}/${nameSeg}` : nameSeg;
      const fullAppName = scoped ? `${parts[0]}/${flat.name}` : flat.name;
      return {
        appName: fullAppName,
        // Flat folder counts as app+version, so depth bumps by 1 to keep
        // legacy depth semantics ("flat unit root is depth 2 in the
        // unscoped case, depth 3 in the scoped case").
        depth: parts.length + 1,
        unitRoot,
        version: flat.version,
      };
    }

    // Nested form: name/version/...
    const versionIdx = nameIdx + 1;
    if (parts.length === versionIdx) {
      // We're at the name folder; no version segment yet.
      return { appName: fullName, depth: parts.length, unitRoot: null, version: null };
    }

    const versionSeg = parts[versionIdx]!;
    if (!isValidVersion(versionSeg)) {
      return { appName: fullName, depth: parts.length, unitRoot: null, version: null };
    }

    const unitRoot = scoped ? `${parts[0]}/${nameSeg}/${versionSeg}` : `${nameSeg}/${versionSeg}`;
    return {
      appName: fullName,
      depth: parts.length,
      unitRoot,
      version: versionSeg,
    };
  },

  canWriteAt(relativePath) {
    return workersPathPolicy.parse(relativePath).unitRoot !== null;
  },

  isUnitRoot(relativePath) {
    const parsed = workersPathPolicy.parse(relativePath);
    if (!parsed.unitRoot) return false;
    return cleanPath(relativePath) === parsed.unitRoot;
  },

  isInsideUnit(relativePath) {
    const parsed = workersPathPolicy.parse(relativePath);
    if (!parsed.unitRoot) return false;
    const clean = cleanPath(relativePath);
    return clean !== parsed.unitRoot && clean.startsWith(`${parsed.unitRoot}/`);
  },
};

// ---------------------------------------------------------------------------
// Plugins policy (free-form, scope-aware)
// ---------------------------------------------------------------------------

/**
 * Plugins policy — plugins live as flat `{name}/` folders (no versioning).
 * Scoped plugins use `@scope/name/` and are treated as a single unit.
 * The plugin root is the "unit" with a manifest. Anything below it is
 * free-form: uploads, moves, mkdir all allowed.
 */
export const pluginsPathPolicy: PathPolicy = {
  name: "plugins",

  parse(relativePath) {
    const parts = splitParts(relativePath);
    if (parts.length === 0) return EMPTY;

    const scoped = hasScopePrefix(parts);

    // Just the @scope folder, no plugin name yet.
    if (scoped && parts.length === 1) {
      return { appName: null, depth: 1, unitRoot: null, version: null };
    }

    const appName = scoped ? `${parts[0]}/${parts[1]}` : parts[0]!;
    return {
      appName,
      depth: parts.length,
      unitRoot: appName,
      version: null,
    };
  },

  canWriteAt(relativePath) {
    return pluginsPathPolicy.parse(relativePath).unitRoot !== null;
  },

  isUnitRoot(relativePath) {
    const parsed = pluginsPathPolicy.parse(relativePath);
    if (!parsed.unitRoot) return false;
    return cleanPath(relativePath) === parsed.unitRoot;
  },

  isInsideUnit(relativePath) {
    const parsed = pluginsPathPolicy.parse(relativePath);
    if (!parsed.unitRoot) return false;
    const clean = cleanPath(relativePath);
    return clean !== parsed.unitRoot && clean.startsWith(`${parsed.unitRoot}/`);
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
  // Detect format: if the name segment (parts[1] when scoped, parts[0] otherwise)
  // matches `<name>@<version>`, it's flat.
  const parts = splitParts(path);
  const scoped = hasScopePrefix(parts);
  const nameSeg = scoped ? parts[1] : parts[0];
  const flat = nameSeg ? parseFlatFolder(nameSeg) : null;
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
