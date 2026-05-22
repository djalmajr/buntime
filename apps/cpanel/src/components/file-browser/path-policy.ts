/**
 * Client-side path policies — mirror the server's
 * `apps/runtime/src/libs/fs/path-policies.ts`. Encapsulates the format
 * differences between the workers surface (semver `app@version` / `app/version`)
 * and the plugins surface (flat `name/`).
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
      };
    }
    const first = parts[0]!;
    const flat = parseFlat(first);
    if (flat) {
      // Flat: depth bumped by 1 (flat folder counts as app+version)
      const depth = parts.length + 1;
      return {
        appName: flat.name,
        depth,
        isInsideUnit: depth >= 3,
        isUnitRoot: depth === 2,
        unitRoot: first,
      };
    }
    if (parts.length === 1) {
      return {
        appName: first,
        depth: 1,
        isInsideUnit: false,
        isUnitRoot: false,
        unitRoot: null,
      };
    }
    const second = parts[1]!;
    if (isValidVersion(second)) {
      const depth = parts.length;
      return {
        appName: first,
        depth,
        isInsideUnit: depth >= 3,
        isUnitRoot: depth === 2,
        unitRoot: `${first}/${second}`,
      };
    }
    return {
      appName: first,
      depth: parts.length,
      isInsideUnit: false,
      isUnitRoot: false,
      unitRoot: null,
    };
  },

  canWriteAt(relativePath) {
    return workersClientPolicy.parse(relativePath).unitRoot !== null;
  },

  validateFolderName(parentPath, name) {
    const trimmed = name.trim();
    if (!trimmed) return "Name is required";

    const parsed = workersClientPolicy.parse(parentPath);
    // depth 0/1: creating an app folder OR a flat app@version
    if (parsed.depth <= 1) {
      const isKebab = KEBAB_CASE_REGEX.test(trimmed);
      const isFlat = parseFlat(trimmed) !== null;
      if (!isKebab && !isFlat) {
        return "Name must be kebab-case (my-app) or app with version (my-app@1.0.0)";
      }
      return null;
    }
    // depth 2 nested without version → must be a semver
    if (parsed.depth === 2 && !parsed.unitRoot) {
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
    if (parsed.depth <= 1) {
      return {
        placeholder: "my-app or my-app@1.0.0",
        description: "Enter a name for the application (kebab-case) or app with version.",
      };
    }
    if (parsed.depth === 2 && !parsed.unitRoot) {
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
      };
    }
    return {
      appName: parts[0]!,
      depth: parts.length,
      isInsideUnit: parts.length >= 2,
      isUnitRoot: parts.length === 1,
      unitRoot: parts[0]!,
    };
  },

  canWriteAt(relativePath) {
    return pluginsClientPolicy.parse(relativePath).depth >= 1;
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
