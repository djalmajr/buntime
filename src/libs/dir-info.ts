import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

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

    this.invalidateCache();
  }

  async files(): Promise<number> {
    const info = await this.getInfo();
    return info.files;
  }

  async list(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];

    try {
      const glob = new Bun.Glob("*");
      for await (const name of glob.scan({ cwd: this.fullPath, onlyFiles: false })) {
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

  async rename(newName: string): Promise<void> {
    const parentDir = this.dirPath.includes("/")
      ? this.dirPath.substring(0, this.dirPath.lastIndexOf("/"))
      : "";
    const newPath = join(this.basePath, parentDir, newName);

    const proc = Bun.spawn(["mv", this.fullPath, newPath]);
    await proc.exited;

    this.dirPath = parentDir ? `${parentDir}/${newName}` : newName;
    this.invalidateCache();
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
    await Bun.write(filePath, content);
    this.invalidateCache();
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
      const [dirStats, infoExists] = await Promise.all([stat(this.fullPath), infoFile.exists()]);

      if (infoExists) {
        const infoStats = await stat(this.infoPath);
        if (infoStats.mtime >= dirStats.mtime) {
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
}
