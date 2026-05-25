/**
 * @module
 * Generic filesystem walker / cache used by the runtime's file-browser routes
 * (mounted at `/api/workers/files` and `/api/plugins/files`).
 *
 * Provides:
 * - `DirInfo` — wraps a directory with FS ops (list/mkdir/rename/move/delete/
 *   extract-zip/writeFile) plus a `.dirinfo` cache file that memoises folder
 *   stats (file count, total size, latest mtime). Cache is invalidated on
 *   mutations and when any direct child has a newer mtime than `.dirinfo`.
 * - `FileEntry` — entry shape returned by `list()`.
 *
 * Policy-driven: a `PathPolicy` argument decides where uploads/moves may land
 * and which folders are "units" with a manifest. Workers and plugins each
 * supply their own policy (see `path-policies.ts`).
 *
 * Ported from `plugins/plugin-deployments/server/libs/dir-info.ts`; behavior
 * unchanged for workers (the legacy code used the workers semantics).
 */

import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type ConfigValidation,
  validateWorkerConfig,
} from "@buntime/shared/utils/config-validation";
import type { PathPolicy } from "./path-policies";
import { workersPathPolicy } from "./path-policies";

export type { ConfigValidation };

const DIRINFO_FILE = ".dirinfo";

type Visibility = "public" | "protected" | "internal";

interface BuntimeConfig {
  excludes?: string[];
  idleTimeout?: number | string;
  timeout?: number | string;
  ttl?: number | string;
  visibility?: Visibility;
}

async function readManifestConfig(dirPath: string): Promise<BuntimeConfig | undefined> {
  for (const filename of ["manifest.yaml", "manifest.yml"]) {
    try {
      const manifestPath = join(dirPath, filename);
      const manifestFile = Bun.file(manifestPath);
      if (await manifestFile.exists()) {
        const content = await manifestFile.text();
        return Bun.YAML.parse(content) as BuntimeConfig;
      }
    } catch {
      // Ignore parse errors
    }
  }
  return undefined;
}

async function readVisibility(dirPath: string): Promise<Visibility | undefined> {
  const config = await readManifestConfig(dirPath);
  return config?.visibility;
}

interface DirInfoCache {
  files: number;
  size: number;
  updatedAt: string;
}

export interface FileEntry {
  configValidation?: ConfigValidation;
  files?: number;
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
  visibility?: "public" | "protected" | "internal";
}

export class DirInfo {
  /** Global excludes set from runtime configuration. */
  static globalExcludes: string[] = [];

  private basePath: string;
  private cache: DirInfoCache | null = null;
  private dirPath: string;
  private policy: PathPolicy;

  /**
   * @param basePath  Absolute path of the mount root (a single workerDir or pluginDir).
   * @param dirPath   Relative path under the mount root. "" means the mount root itself.
   * @param policy    Path policy. Defaults to the workers semver-aware policy
   *                  to preserve historical behavior.
   */
  constructor(basePath: string, dirPath = "", policy: PathPolicy = workersPathPolicy) {
    this.basePath = basePath;
    this.dirPath = dirPath;
    this.policy = policy;
  }

  get fullPath(): string {
    return join(this.basePath, this.dirPath);
  }

  private get infoPath(): string {
    return join(this.fullPath, DIRINFO_FILE);
  }

  async create(): Promise<void> {
    await mkdir(this.fullPath, { recursive: true });
  }

  async delete(): Promise<void> {
    const file = Bun.file(this.fullPath);

    if (await file.exists()) {
      await file.unlink();
    } else {
      const proc = Bun.spawn(["rm", "-rf", this.fullPath]);
      await proc.exited;
    }

    this.invalidateParentCaches();
  }

  async extractZip(zipBuffer: ArrayBuffer): Promise<void> {
    const tempZip = join(this.fullPath, ".temp-upload.zip");

    await Bun.write(tempZip, zipBuffer);

    const proc = Bun.spawn(["unzip", "-o", "-q", tempZip, "-d", this.fullPath]);
    await proc.exited;

    const tempFile = Bun.file(tempZip);
    if (await tempFile.exists()) {
      await tempFile.unlink();
    }

    this.invalidateCacheWithParents();
  }

  async files(): Promise<number> {
    const info = await this.getInfo();
    return info.files;
  }

  async refresh(): Promise<void> {
    await this.invalidateAllCaches();
  }

  private async invalidateAllCaches(): Promise<void> {
    try {
      const proc = Bun.spawn(["find", this.fullPath, "-name", ".dirinfo", "-type", "f", "-delete"]);
      await proc.exited;
    } catch {
      // Ignore errors
    }

    this.invalidateCacheWithParents();
  }

  async list(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];

    const inheritedVisibility = await this.getAncestorVisibility();
    const excludes = await this.getExcludes();

    try {
      const glob = new Bun.Glob("*");
      for await (const name of glob.scan({ cwd: this.fullPath, dot: true, onlyFiles: false })) {
        if (name === DIRINFO_FILE || excludes.has(name)) continue;

        const entryPath = join(this.fullPath, name);
        const stats = await stat(entryPath);
        const isDirectory = stats.isDirectory();
        const relativePath = this.dirPath ? `${this.dirPath}/${name}` : name;

        if (isDirectory) {
          const subDir = new DirInfo(this.basePath, relativePath, this.policy);
          const info = await subDir.getInfo();

          // Read visibility from manifest config if exists.
          let visibility = await readVisibility(entryPath);

          // For folders that don't carry their own visibility, the workers
          // policy also lets a parent inherit "protected" from any child
          // version folder. For plugins, this branch is never taken (a plugin
          // folder either declares its own visibility or none).
          if (!visibility && this.policy.name === "workers") {
            visibility = await this.getChildVersionsVisibility(entryPath);
          }

          if (!visibility && inheritedVisibility) {
            visibility = inheritedVisibility;
          }

          let configValidation: ConfigValidation | undefined;
          if (this.policy.isUnitRoot(relativePath)) {
            const config = await readManifestConfig(entryPath);
            if (config) {
              configValidation = validateWorkerConfig(config);
            }
          }

          entries.push({
            configValidation,
            files: info.files,
            isDirectory,
            name,
            path: relativePath,
            size: info.size,
            updatedAt: info.updatedAt,
            visibility,
          });
        } else {
          entries.push({
            isDirectory,
            name,
            path: relativePath,
            size: stats.size,
            updatedAt: stats.mtime.toISOString(),
            visibility: inheritedVisibility,
          });
        }
      }
    } catch {
      return [];
    }

    return entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Move this entry into `destPath` (relative to the mount root). The policy
   * decides whether the source is moveable (strictly inside a unit; you can
   * never relocate the unit root itself — version/plugin folder) and whether
   * the destination is a valid write target.
   */
  async move(destPath: string): Promise<void> {
    if (!this.policy.isInsideUnit(this.dirPath)) {
      throw new Error("Cannot move app or version folders");
    }

    const name = this.dirPath.includes("/")
      ? this.dirPath.substring(this.dirPath.lastIndexOf("/") + 1)
      : this.dirPath;

    const destFullPath = resolve(this.basePath, destPath);
    if (!destFullPath.startsWith(this.basePath)) {
      throw new Error("Destination path is outside allowed directory");
    }

    if (!this.policy.canWriteAt(destPath)) {
      throw new Error("Destination must be inside an app version");
    }

    try {
      const destStats = await stat(destFullPath);
      if (!destStats.isDirectory()) {
        throw new Error("Destination is not a directory");
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("Destination directory does not exist");
      }
      throw err;
    }

    const newFullPath = join(destFullPath, name);

    try {
      await stat(newFullPath);
      throw new Error("An item with this name already exists at destination");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    const proc = Bun.spawn(["mv", this.fullPath, newFullPath]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error("Failed to move item");
    }

    this.invalidateCacheWithParents();

    const newDir = new DirInfo(this.basePath, destPath, this.policy);
    newDir.invalidateCacheWithParents();
  }

  async rename(newName: string): Promise<void> {
    const parentDir = this.dirPath.includes("/")
      ? this.dirPath.substring(0, this.dirPath.lastIndexOf("/"))
      : "";
    const newPath = join(this.basePath, parentDir, newName);

    const proc = Bun.spawn(["mv", this.fullPath, newPath]);
    await proc.exited;

    this.dirPath = parentDir ? `${parentDir}/${newName}` : newName;
    this.invalidateCacheWithParents();
  }

  async size(): Promise<number> {
    const info = await this.getInfo();
    return info.size;
  }

  async updatedAt(): Promise<string> {
    const info = await this.getInfo();
    return info.updatedAt;
  }

  /** Visibility for this directory (own manifest, then ancestor inheritance). */
  async getVisibility(): Promise<Visibility | undefined> {
    const ownVisibility = await readVisibility(this.fullPath);
    if (ownVisibility) return ownVisibility;
    return this.getAncestorVisibility();
  }

  /**
   * Combined excludes — global defaults + per-unit overrides read from the
   * containing unit's manifest. The unit root is resolved by the policy.
   */
  private async getExcludes(): Promise<Set<string>> {
    const excludes = new Set(DirInfo.globalExcludes);

    if (this.dirPath) {
      const parsed = this.policy.parse(this.dirPath);
      if (parsed.unitRoot) {
        const unitDir = join(this.basePath, parsed.unitRoot);
        const config = await readManifestConfig(unitDir);
        if (config?.excludes) {
          for (const pattern of config.excludes) {
            excludes.add(pattern);
          }
        }
      }
    }

    return excludes;
  }

  async writeFile(fileName: string, content: ArrayBuffer | string): Promise<void> {
    const filePath = join(this.fullPath, fileName);

    if (fileName.includes("/")) {
      const dirPath = filePath.substring(0, filePath.lastIndexOf("/"));
      await mkdir(dirPath, { recursive: true });
    }

    await Bun.write(filePath, content);
    this.invalidateCacheWithParents();
  }

  private async calculateInfo(): Promise<DirInfoCache> {
    let files = 0;
    let size = 0;
    let latestMtime = new Date(0);

    const glob = new Bun.Glob("**/*");

    try {
      for await (const filePath of glob.scan({ cwd: this.fullPath, onlyFiles: true })) {
        if (filePath === DIRINFO_FILE) continue;
        const fullPath = join(this.fullPath, filePath);
        const stats = await stat(fullPath);
        files++;
        size += stats.size;
        if (stats.mtime > latestMtime) latestMtime = stats.mtime;
      }
    } catch {
      // Ignore errors
    }

    return {
      files,
      size,
      updatedAt: latestMtime.toISOString(),
    };
  }

  private async getInfo(): Promise<DirInfoCache> {
    if (this.cache) return this.cache;

    const infoFile = Bun.file(this.infoPath);

    try {
      const infoExists = await infoFile.exists();

      if (infoExists) {
        const infoStats = await stat(this.infoPath);

        // Catch external modifications (e.g., `bun install` creating node_modules).
        let cacheValid = true;
        const glob = new Bun.Glob("*");

        for await (const name of glob.scan({ cwd: this.fullPath, onlyFiles: false })) {
          if (name === DIRINFO_FILE) continue;
          const entryPath = join(this.fullPath, name);
          const entryStats = await stat(entryPath);

          if (entryStats.mtime > infoStats.mtime) {
            cacheValid = false;
            break;
          }
        }

        if (cacheValid) {
          this.cache = await infoFile.json();
          return this.cache!;
        }
      }
    } catch {
      // Continue to calculate
    }

    const info = await this.calculateInfo();

    Bun.write(this.infoPath, JSON.stringify(info)).catch(() => {});

    this.cache = info;
    return info;
  }

  private invalidateCache(): void {
    this.cache = null;
    Bun.file(this.infoPath)
      .unlink()
      .catch(() => {});
  }

  private invalidateCacheWithParents(): void {
    this.invalidateCache();
    this.invalidateParentCaches();
  }

  private invalidateParentCaches(): void {
    if (!this.dirPath) return;

    const parentPath = this.dirPath.includes("/")
      ? this.dirPath.substring(0, this.dirPath.lastIndexOf("/"))
      : "";

    const parent = new DirInfo(this.basePath, parentPath, this.policy);
    parent.invalidateCacheWithParents();
  }

  /**
   * Ancestor visibility — read from the unit root's manifest. Used so files
   * inside a protected version/plugin inherit the parent's visibility.
   */
  private async getAncestorVisibility(): Promise<Visibility | undefined> {
    if (!this.dirPath) return undefined;

    const parsed = this.policy.parse(this.dirPath);
    if (parsed.unitRoot) {
      const unitDir = join(this.basePath, parsed.unitRoot);
      return readVisibility(unitDir);
    }

    // Workers special case: when looking at a path that is the app folder
    // (no version), still surface visibility from the app folder itself so
    // its eventual version children carry it. Plugins handled by isUnitRoot above.
    if (this.policy.name === "workers" && parsed.depth === 1 && parsed.appName) {
      const appDir = join(this.basePath, parsed.appName);
      return readVisibility(appDir);
    }

    return undefined;
  }

  /**
   * Workers-only: when listing app folders (nested format), pick the most
   * restrictive visibility found in any version subfolder so the app row in
   * the UI reflects protected children.
   */
  private async getChildVersionsVisibility(entryPath: string): Promise<Visibility | undefined> {
    const glob = new Bun.Glob("*");
    let mostRestrictive: Visibility | undefined;

    try {
      for await (const childName of glob.scan({ cwd: entryPath, onlyFiles: false })) {
        // Recognize version folder names via the policy (semver or "latest").
        if (!this.policy.isUnitRoot(`__probe__/${childName}`)) continue;

        const childDir = join(entryPath, childName);
        const visibility = await readVisibility(childDir);

        if (visibility) {
          if (visibility === "internal") return "internal";
          if (visibility === "protected") mostRestrictive = "protected";
          if (visibility === "public" && !mostRestrictive) mostRestrictive = "public";
        }
      }
    } catch {
      // Ignore errors
    }

    return mostRestrictive;
  }
}
