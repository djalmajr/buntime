import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isValidUploadDestination, parseDeploymentPath } from "@/utils/deployment-path";

const DIRINFO_FILE = ".dirinfo";

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
}

export class DirInfo {
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

    try {
      const glob = new Bun.Glob("*");
      for await (const name of glob.scan({ cwd: this.fullPath, dot: true, onlyFiles: false })) {
        if (name === DIRINFO_FILE) continue;

        const entryPath = join(this.fullPath, name);
        const stats = await stat(entryPath);
        const isDirectory = stats.isDirectory();
        const relativePath = this.dirPath ? `${this.dirPath}/${name}` : name;

        if (isDirectory) {
          const subDir = new DirInfo(this.basePath, relativePath);
          const info = await subDir.getInfo();
          entries.push({
            files: info.files,
            isDirectory,
            name,
            path: relativePath,
            size: info.size,
            updatedAt: info.updatedAt,
          });
        } else {
          entries.push({
            isDirectory,
            name,
            path: relativePath,
            size: stats.size,
            updatedAt: stats.mtime.toISOString(),
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
}
