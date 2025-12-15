import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { valid } from "semver";
import { isValidUploadDestination, parseDeploymentPath } from "../utils/deployment-path";

const DIRINFO_FILE = ".dirinfo";

type Visibility = "public" | "protected" | "internal";

interface BuntimeConfig {
  excludes?: string[];
  visibility?: Visibility;
}

/**
 * Check if a string is a valid version (semver or "latest")
 */
function isValidVersion(version: string): boolean {
  return valid(version) !== null || version === "latest";
}

/**
 * Read buntime config from a package.json file
 */
async function readBuntimeConfig(pkgPath: string): Promise<BuntimeConfig | undefined> {
  try {
    const pkgFile = Bun.file(pkgPath);
    if (await pkgFile.exists()) {
      const pkg = (await pkgFile.json()) as { buntime?: BuntimeConfig };
      if (pkg.buntime) {
        return pkg.buntime;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

/**
 * Read visibility from a package.json file
 */
async function readVisibility(pkgPath: string): Promise<Visibility | undefined> {
  const config = await readBuntimeConfig(pkgPath);
  return config?.visibility;
}

interface DirInfoCache {
  files: number;
  size: number;
  updatedAt: string;
}

export interface FileEntry {
  files?: number;
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
  visibility?: "public" | "protected" | "internal";
}

export class DirInfo {
  /** Global excludes set from plugin configuration */
  static globalExcludes: string[] = [];

  private basePath: string;
  private cache: DirInfoCache | null = null;
  private dirPath: string;

  constructor(basePath: string, dirPath = "") {
    this.basePath = basePath;
    this.dirPath = dirPath;
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
    // Invalidate all children recursively using find + rm
    try {
      const proc = Bun.spawn(["find", this.fullPath, "-name", ".dirinfo", "-type", "f", "-delete"]);
      await proc.exited;
    } catch {
      // Ignore errors
    }

    // Then invalidate current and parents
    this.invalidateCacheWithParents();
  }

  async list(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];

    // Check if we're inside a protected version (inherit visibility from ancestor)
    const inheritedVisibility = await this.getAncestorVisibility();

    // Get combined excludes (global + per-app from version folder)
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
          const subDir = new DirInfo(this.basePath, relativePath);
          const info = await subDir.getInfo();

          // Read visibility from package.json if exists
          let visibility = await readVisibility(join(entryPath, "package.json"));

          // For app folders (nested format), check if any version child is protected
          if (!visibility) {
            visibility = await this.getChildVersionsVisibility(entryPath, name);
          }

          // Inherit from ancestor if inside a protected version
          if (!visibility && inheritedVisibility) {
            visibility = inheritedVisibility;
          }

          entries.push({
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

  async move(destPath: string): Promise<void> {
    // Validate source is inside a version folder (can't move app or version folders themselves)
    const sourceInfo = parseDeploymentPath(this.dirPath);
    // For nested: depth 3+ means inside version (app/version/file)
    // For flat: depth 2+ means inside version (app@version/file)
    const minSourceDepth = sourceInfo.format === "flat" ? 2 : 3;
    if (sourceInfo.depth < minSourceDepth) {
      throw new Error("Cannot move app or version folders");
    }

    const name = this.dirPath.includes("/")
      ? this.dirPath.substring(this.dirPath.lastIndexOf("/") + 1)
      : this.dirPath;

    // Validate destination is within basePath (prevent path traversal)
    const destFullPath = resolve(this.basePath, destPath);
    if (!destFullPath.startsWith(this.basePath)) {
      throw new Error("Destination path is outside allowed directory");
    }

    // Validate destination is inside a version folder (flat or nested)
    if (!isValidUploadDestination(destPath)) {
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

    // Check if target already exists
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

    // Invalidate old location
    this.invalidateCacheWithParents();

    // Invalidate new location
    const newDir = new DirInfo(this.basePath, destPath);
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

  /**
   * Get the visibility of this directory (from its package.json or inherited from ancestor)
   */
  async getVisibility(): Promise<Visibility | undefined> {
    // First check if this folder has its own visibility
    const ownVisibility = await readVisibility(join(this.fullPath, "package.json"));
    if (ownVisibility) return ownVisibility;

    // Otherwise check ancestor visibility (if inside a version folder)
    return this.getAncestorVisibility();
  }

  /**
   * Get combined excludes (global + per-app from version folder's package.json)
   * Returns a Set for fast lookup
   */
  private async getExcludes(): Promise<Set<string>> {
    // Start with global excludes
    const excludes = new Set(DirInfo.globalExcludes);

    // If inside a version folder, check for per-app excludes
    if (this.dirPath) {
      const pathInfo = parseDeploymentPath(this.dirPath);

      if (pathInfo.isInsideVersion || pathInfo.depth >= 1) {
        const parts = this.dirPath.split("/");
        let versionFolderPath: string;

        if (pathInfo.format === "flat") {
          // Flat format: first part is app@version
          versionFolderPath = parts[0]!;
        } else if (pathInfo.depth >= 2) {
          // Nested format: first two parts are app/version
          versionFolderPath = parts.slice(0, 2).join("/");
        } else {
          // At app level, no per-app excludes yet
          return excludes;
        }

        // Read excludes from version folder's package.json
        const pkgPath = join(this.basePath, versionFolderPath, "package.json");
        const config = await readBuntimeConfig(pkgPath);
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

    // Create subdirectories if fileName contains path separators
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

        // Check if any direct child has mtime newer than .dirinfo
        // This catches external modifications (e.g., bun install creating node_modules)
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

    // Save cache (fire and forget)
    Bun.write(this.infoPath, JSON.stringify(info)).catch(() => {});

    this.cache = info;
    return info;
  }

  private invalidateCache(): void {
    this.cache = null;
    // Remove cached file
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

    const parent = new DirInfo(this.basePath, parentPath);
    parent.invalidateCacheWithParents();
  }

  /**
   * Get visibility from ancestor version folder (for inheritance to children)
   * Walks up the path to find the nearest version folder with visibility
   */
  private async getAncestorVisibility(): Promise<Visibility | undefined> {
    if (!this.dirPath) return undefined;

    const pathInfo = parseDeploymentPath(this.dirPath);

    // Only inherit if we're inside a version folder
    if (!pathInfo.isInsideVersion) return undefined;

    // Find the version folder path
    const parts = this.dirPath.split("/");
    let versionFolderPath: string;

    if (pathInfo.format === "flat") {
      // Flat format: first part is app@version
      versionFolderPath = parts[0]!;
    } else {
      // Nested format: first two parts are app/version
      versionFolderPath = parts.slice(0, 2).join("/");
    }

    // Read visibility from version folder's package.json
    const pkgPath = join(this.basePath, versionFolderPath, "package.json");
    return readVisibility(pkgPath);
  }

  /**
   * For app folders (nested format), check if any child version folder is protected
   * Returns the most restrictive visibility found
   */
  private async getChildVersionsVisibility(
    entryPath: string,
    _name: string,
  ): Promise<Visibility | undefined> {
    // Check if this folder contains version subfolders
    const glob = new Bun.Glob("*");
    let mostRestrictive: Visibility | undefined;

    try {
      for await (const childName of glob.scan({ cwd: entryPath, onlyFiles: false })) {
        // Check if child is a version folder (semver or "latest")
        if (!isValidVersion(childName)) continue;

        const childPkgPath = join(entryPath, childName, "package.json");
        const visibility = await readVisibility(childPkgPath);

        if (visibility) {
          // "internal" is most restrictive, then "protected", then "public"
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
