/**
 * Client-side path policies — mirror the server's
 * `apps/runtime/src/libs/fs/path-policies.ts`. Encapsulates the format
 * differences between the workers surface (semver `app@version` / `app/version`)
 * and the plugins surface (flat `name/`).
 *
 * Both policies are **scope-aware**: if the first segment starts with `@`,
 * the next segment is treated as the second half of the unit name
 * (npm-style scoped packages: `@scope/name` is ONE name, not two folders).
 */

// kebab-case: lowercase letters, numbers, hyphens (not at start/end)
const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Semantic versioning: major.minor.patch[-prerelease] (with optional v prefix)
const SEMVER_REGEX =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/;

/** Lightweight semver / "latest" check — server enforces the canonical rule. */
function isValidVersion(version: string): boolean {
  return SEMVER_REGEX.test(version) || version === "latest";
}

function parseFlat(folderName: string): { name: string; version: string } | null {
  const at = folderName.lastIndexOf("@");
  if (at === -1) return null;
  const name = folderName.slice(0, at);
  const version = folderName.slice(at + 1);
  if (!name || !isValidVersion(version)) return null;
  return { name, version };
}

export interface ClientParsedPath {
  appName: string | null;
  depth: number;
  isInsideUnit: boolean;
  isUnitRoot: boolean;
  unitRoot: string | null;
  /** Semver/“latest” version when the path is inside a worker unit. */
  version: string | null;
}

export interface ClientPathPolicy {
  /** Debug-only identifier. */
  name: "workers" | "plugins";
  /** Root label shown in breadcrumbs (e.g. "Workers", "Plugins"). */
  rootLabel: string;
  /** True if uploads/folder creation may target this path. */
  canWriteAt(relativePath: string): boolean;
  parse(relativePath: string): ClientParsedPath;
  /**
   * Validate a new folder name at `parentPath`. Returns `null` if valid,
   * otherwise a localized error message.
   */
  validateFolderName(parentPath: string, name: string): string | null;
  /** Placeholder + description shown by the "new folder" dialog. */
  folderHints(parentPath: string): { placeholder: string; description: string };
}

function splitParts(path: string): string[] {
  return path ? path.split("/").filter(Boolean) : [];
}

function hasScopePrefix(parts: string[]): boolean {
  return parts.length >= 1 && parts[0]!.startsWith("@");
}

function cleanPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

// ---------------------------------------------------------------------------

export const workersClientPolicy: ClientPathPolicy = {
  name: "workers",
  rootLabel: "Workers",

  parse(relativePath) {
    const parts = splitParts(relativePath);
    if (parts.length === 0) {
      return {
        appName: null,
        depth: 0,
        isInsideUnit: false,
        isUnitRoot: false,
        unitRoot: null,
        version: null,
      };
    }
    const scoped = hasScopePrefix(parts);

    // @scope alone — no name yet.
    if (scoped && parts.length === 1) {
      return {
        appName: null,
        depth: 1,
        isInsideUnit: false,
        isUnitRoot: false,
        unitRoot: null,
        version: null,
      };
    }

    const nameIdx = scoped ? 1 : 0;
    const nameSeg = parts[nameIdx]!;
    const fullName = scoped ? `${parts[0]}/${nameSeg}` : nameSeg;
    const clean = cleanPath(relativePath);

    // Flat form: name@version
    const flat = parseFlat(nameSeg);
    if (flat) {
      const unitRoot = scoped ? `${parts[0]}/${nameSeg}` : nameSeg;
      const fullAppName = scoped ? `${parts[0]}/${flat.name}` : flat.name;
      const depth = parts.length + 1; // flat folder counts as app+version
      return {
        appName: fullAppName,
        depth,
        isInsideUnit: clean !== unitRoot && clean.startsWith(`${unitRoot}/`),
        isUnitRoot: clean === unitRoot,
        unitRoot,
        version: flat.version,
      };
    }

    // Nested form: name/version
    const versionIdx = nameIdx + 1;
    if (parts.length === versionIdx) {
      return {
        appName: fullName,
        depth: parts.length,
        isInsideUnit: false,
        isUnitRoot: false,
        unitRoot: null,
        version: null,
      };
    }
    const versionSeg = parts[versionIdx]!;
    if (!isValidVersion(versionSeg)) {
      return {
        appName: fullName,
        depth: parts.length,
        isInsideUnit: false,
        isUnitRoot: false,
        unitRoot: null,
        version: null,
      };
    }
    const unitRoot = scoped ? `${parts[0]}/${nameSeg}/${versionSeg}` : `${nameSeg}/${versionSeg}`;
    return {
      appName: fullName,
      depth: parts.length,
      isInsideUnit: clean !== unitRoot && clean.startsWith(`${unitRoot}/`),
      isUnitRoot: clean === unitRoot,
      unitRoot,
      version: versionSeg,
    };
  },

  canWriteAt(relativePath) {
    return workersClientPolicy.parse(relativePath).unitRoot !== null;
  },

  validateFolderName(parentPath, name) {
    const trimmed = name.trim();
    if (!trimmed) return "Name is required";

    const parsed = workersClientPolicy.parse(parentPath);
    const parts = splitParts(parentPath);
    const scoped = hasScopePrefix(parts);

    // depth 0/1 (or 1 for @scope without name yet): creating an app folder
    // OR a flat app@version. For @scope/<here> we're at the name slot.
    if (parsed.depth <= 1 || (scoped && parsed.depth === 1)) {
      const isKebab = KEBAB_CASE_REGEX.test(trimmed);
      const isFlat = parseFlat(trimmed) !== null;
      if (!isKebab && !isFlat) {
        return "Name must be kebab-case (my-app) or app with version (my-app@1.0.0)";
      }
      return null;
    }
    // depth==2 unscoped without version → must be semver. Same for depth==3 scoped.
    if (!parsed.unitRoot && (parsed.depth === 2 || (scoped && parsed.depth === 2))) {
      if (!SEMVER_REGEX.test(trimmed)) {
        return "Version must follow semantic versioning (e.g., 1.0.0, 1.0.0-rc.1)";
      }
      return null;
    }
    // Otherwise free-form name (anywhere inside a version folder)
    return null;
  },

  folderHints(parentPath) {
    const parsed = workersClientPolicy.parse(parentPath);
    const parts = splitParts(parentPath);
    const scoped = hasScopePrefix(parts);

    if (parsed.depth === 0) {
      return {
        placeholder: "my-app, my-app@1.0.0 or @scope",
        description: "Enter an app name (kebab-case), app@version, or a scope folder (@my-scope).",
      };
    }
    if (scoped && parsed.depth === 1) {
      return {
        placeholder: "my-app or my-app@1.0.0",
        description: "Enter a name for the scoped app (kebab-case) or app with version.",
      };
    }
    if (!parsed.unitRoot && parsed.depth >= 1) {
      return {
        placeholder: "1.0.0",
        description: "Enter the version number (semantic versioning).",
      };
    }
    return {
      placeholder: "Folder name",
      description: "Enter a name for the new folder.",
    };
  },
};

// ---------------------------------------------------------------------------

export const pluginsClientPolicy: ClientPathPolicy = {
  name: "plugins",
  rootLabel: "Plugins",

  parse(relativePath) {
    const parts = splitParts(relativePath);
    if (parts.length === 0) {
      return {
        appName: null,
        depth: 0,
        isInsideUnit: false,
        isUnitRoot: false,
        unitRoot: null,
        version: null,
      };
    }
    const scoped = hasScopePrefix(parts);

    // @scope alone — no plugin yet.
    if (scoped && parts.length === 1) {
      return {
        appName: null,
        depth: 1,
        isInsideUnit: false,
        isUnitRoot: false,
        unitRoot: null,
        version: null,
      };
    }

    const appName = scoped ? `${parts[0]}/${parts[1]}` : parts[0]!;
    const clean = cleanPath(relativePath);
    return {
      appName,
      depth: parts.length,
      isInsideUnit: clean !== appName && clean.startsWith(`${appName}/`),
      isUnitRoot: clean === appName,
      unitRoot: appName,
      version: null,
    };
  },

  canWriteAt(relativePath) {
    return pluginsClientPolicy.parse(relativePath).unitRoot !== null;
  },

  validateFolderName(_parentPath, name) {
    const trimmed = name.trim();
    if (!trimmed) return "Name is required";
    // Plugin folder names follow npm package naming loosely; accept any
    // non-empty name. Reject obvious separators that would create nested paths.
    if (trimmed.includes("/")) return "Name cannot contain '/'";
    return null;
  },

  folderHints(_parentPath) {
    return {
      placeholder: "Folder name",
      description: "Enter a name for the new folder.",
    };
  },
};
