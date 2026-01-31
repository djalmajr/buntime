import { basename, join } from "node:path";
import { errorToResponse, NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { DirInfo } from "./libs/dir-info";

// Multiple worker directories support (set via BUNTIME_WORKER_DIRS env var)
let workerDirs: string[] = [];
let dirNameMap: Map<string, string> = new Map(); // dirName -> fullPath

// Global excludes (folders to hide from listing)
const DEFAULT_EXCLUDES = [".git", "node_modules"];
let globalExcludes: string[] = [...DEFAULT_EXCLUDES];

export function setWorkerDirs(dirs: string[]): void {
  workerDirs = dirs;
  // Build name -> path map, handling duplicates with index suffix
  // Folders starting with "." are hidden from deployments listing but still served
  dirNameMap = new Map();
  const nameCounts: Record<string, number> = {};

  for (const dir of dirs) {
    let name = basename(dir);
    const count = (nameCounts[name] || 0) + 1;
    nameCounts[name] = count;
    if (count > 1) {
      name = `${name}-${count}`;
    }
    // Skip hidden directories (starting with ".") from UI listing
    if (!name.startsWith(".")) {
      dirNameMap.set(name, dir);
    }
  }
}

export function setExcludes(excludes: string[], replace = false): void {
  globalExcludes = replace ? excludes : [...new Set([...DEFAULT_EXCLUDES, ...excludes])];
  DirInfo.globalExcludes = globalExcludes;
}

export function getExcludes(): string[] {
  return globalExcludes;
}

// Initialize from env vars (set by runtime for plugin workers)
// This runs when the module is first imported in the worker process
if (Bun.env.BUNTIME_WORKER_DIRS) {
  try {
    const dirs = JSON.parse(Bun.env.BUNTIME_WORKER_DIRS) as string[];
    if (Array.isArray(dirs) && dirs.length > 0) {
      setWorkerDirs(dirs);
    }
  } catch {
    // Ignore parse errors, use default
  }
}

if (Bun.env.BUNTIME_EXCLUDES) {
  try {
    const excludes = JSON.parse(Bun.env.BUNTIME_EXCLUDES) as string[];
    if (Array.isArray(excludes)) {
      setExcludes(excludes);
    }
  } catch {
    // Ignore parse errors, use default
  }
} else {
  // Initialize DirInfo with default excludes
  DirInfo.globalExcludes = globalExcludes;
}

export function getWorkerDirs(): string[] {
  return workerDirs;
}

export function getDirNames(): string[] {
  return Array.from(dirNameMap.keys());
}

/**
 * Resolve a path to its base directory and relative path
 * Path format: "{rootName}/{relativePath}" or "" for root listing
 */
function resolvePath(path: string): { baseDir: string; relativePath: string; rootName: string } {
  if (!path || path === "/") {
    // Root listing - will show all workerDirs as folders
    return { baseDir: "", relativePath: "", rootName: "" };
  }

  const parts = path.split("/");
  const rootName = parts[0] ?? "";
  const relativePath = parts.slice(1).join("/");

  const baseDir = dirNameMap.get(rootName);
  if (!baseDir) {
    throw new NotFoundError(`Directory not found: ${rootName}`, "DIR_NOT_FOUND");
  }

  return { baseDir, relativePath, rootName };
}

// API routes
export const api = new Hono()
  .basePath("/api")
  // List directory contents
  .get("/list", async (ctx) => {
    const path = ctx.req.query("path") || "";
    const { baseDir, relativePath, rootName } = resolvePath(path);

    // Root listing - show all workerDirs as folders
    if (!baseDir) {
      const entries = [];
      for (const [name, fullPath] of dirNameMap) {
        try {
          const stats = await import("node:fs/promises").then((fs) => fs.stat(fullPath));
          entries.push({
            isDirectory: true,
            name,
            path: name,
            size: 0,
            modifiedAt: stats.mtime.toISOString(),
          });
        } catch {
          // Directory doesn't exist yet, still show it
          entries.push({
            isDirectory: true,
            name,
            path: name,
            size: 0,
            modifiedAt: new Date().toISOString(),
          });
        }
      }
      return ctx.json({ success: true, data: { entries, path: "" } });
    }

    // Regular listing within a workerDir
    const dir = new DirInfo(baseDir, relativePath);
    const rawEntries = await dir.list();
    // Filter out internal apps
    const entries = rawEntries
      .filter((entry) => entry.visibility !== "internal")
      .map((entry) => ({
        ...entry,
        path: rootName + (entry.path ? `/${entry.path}` : `/${entry.name}`),
      }));
    // Get visibility of current folder (for protected upload restriction)
    const currentVisibility = await dir.getVisibility();
    return ctx.json({ success: true, data: { currentVisibility, entries, path } });
  })
  // Create new directory
  .post("/mkdir", async (ctx) => {
    const { path } = await ctx.req.json<{ path: string }>();
    if (!path) {
      throw new ValidationError("Path is required", "PATH_REQUIRED");
    }

    const { baseDir, relativePath } = resolvePath(path);
    if (!baseDir) {
      throw new ValidationError("Cannot create directory at root level", "CANNOT_CREATE_AT_ROOT");
    }

    const dir = new DirInfo(baseDir, relativePath);
    await dir.create();
    return ctx.json({ success: true });
  })
  // Delete file or directory
  .delete("/delete", async (ctx) => {
    const { path } = await ctx.req.json<{ path: string }>();
    if (!path) {
      throw new ValidationError("Path is required", "PATH_REQUIRED");
    }

    const { baseDir, relativePath, rootName } = resolvePath(path);
    if (!baseDir) {
      throw new ValidationError("Cannot delete root directory", "CANNOT_DELETE_ROOT");
    }
    if (!relativePath) {
      throw new ValidationError(`Cannot delete apps directory: ${rootName}`, "CANNOT_DELETE_ROOT");
    }

    const dir = new DirInfo(baseDir, relativePath);
    await dir.delete();
    return ctx.json({ success: true });
  })
  // Rename file or directory
  .post("/rename", async (ctx) => {
    const { path, newName } = await ctx.req.json<{ newName: string; path: string }>();
    if (!path || !newName) {
      throw new ValidationError("Path and newName are required", "PATH_AND_NAME_REQUIRED");
    }

    const { baseDir, relativePath, rootName } = resolvePath(path);
    if (!baseDir || !relativePath) {
      throw new ValidationError(`Cannot rename apps directory: ${rootName}`, "CANNOT_RENAME_ROOT");
    }

    const dir = new DirInfo(baseDir, relativePath);
    await dir.rename(newName);
    return ctx.json({ success: true });
  })
  // Move file or directory
  .post("/move", async (ctx) => {
    const { path, destPath } = await ctx.req.json<{ destPath: string; path: string }>();
    if (!path) {
      throw new ValidationError("Path is required", "PATH_REQUIRED");
    }
    if (destPath === undefined) {
      throw new ValidationError("Destination path is required", "DEST_PATH_REQUIRED");
    }

    const source = resolvePath(path);
    const dest = resolvePath(destPath || source.rootName); // If destPath is empty, move to root of same workerDirs

    if (!source.baseDir || !source.relativePath) {
      throw new ValidationError("Cannot move apps directory", "CANNOT_MOVE_ROOT");
    }

    // For now, only allow moves within the same workerDirs
    if (source.baseDir !== dest.baseDir) {
      throw new ValidationError(
        "Cannot move between different apps directories",
        "CROSS_DIR_MOVE_NOT_SUPPORTED",
      );
    }

    const dir = new DirInfo(source.baseDir, source.relativePath);
    await dir.move(dest.relativePath);
    return ctx.json({ success: true });
  })
  // Upload files
  .post("/upload", async (ctx) => {
    const formData = await ctx.req.formData();
    const targetPath = (formData.get("path") as string) || "";
    const files = formData.getAll("files") as File[];
    const paths = formData.getAll("paths") as string[];

    if (!files.length) {
      throw new ValidationError("No files provided", "NO_FILES_PROVIDED");
    }

    const { baseDir, relativePath } = resolvePath(targetPath);
    if (!baseDir) {
      throw new ValidationError("Cannot upload to root level", "CANNOT_UPLOAD_TO_ROOT");
    }

    const dir = new DirInfo(baseDir, relativePath);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      const fileRelativePath = paths[i] || file.name;
      const content = await file.arrayBuffer();

      if (file.name.endsWith(".zip")) {
        await dir.extractZip(content);
      } else {
        await dir.writeFile(fileRelativePath, content);
      }
    }

    return ctx.json({ success: true });
  })
  // Refresh cache (invalidate .dirinfo)
  .get("/refresh", async (ctx) => {
    const path = ctx.req.query("path") || "";
    const { baseDir, relativePath } = resolvePath(path);

    if (!baseDir) {
      // Refresh all workerDirs
      for (const dir of workerDirs) {
        const dirInfo = new DirInfo(dir, "");
        await dirInfo.refresh();
      }
    } else {
      const dir = new DirInfo(baseDir, relativePath);
      await dir.refresh();
    }
    return ctx.json({ success: true });
  })
  .post("/refresh", async (ctx) => {
    const { path } = await ctx.req.json<{ path?: string }>();
    const { baseDir, relativePath } = resolvePath(path || "");

    if (!baseDir) {
      for (const dir of workerDirs) {
        const dirInfo = new DirInfo(dir, "");
        await dirInfo.refresh();
      }
    } else {
      const dir = new DirInfo(baseDir, relativePath);
      await dir.refresh();
    }
    return ctx.json({ success: true });
  })
  // Download file or folder (folders are zipped)
  .get("/download", async (ctx) => {
    const path = ctx.req.query("path");
    if (!path) {
      throw new ValidationError("Path is required", "PATH_REQUIRED");
    }

    const { baseDir, relativePath, rootName } = resolvePath(path);
    if (!baseDir) {
      throw new ValidationError("Cannot download root", "CANNOT_DOWNLOAD_ROOT");
    }

    const fullPath = relativePath ? join(baseDir, relativePath) : baseDir;
    const filename = relativePath ? relativePath.split("/").pop() || rootName : rootName;

    // Check if it's a directory
    try {
      const stats = await import("node:fs/promises").then((fs) => fs.stat(fullPath));

      if (stats.isDirectory()) {
        // Zip the directory and stream it (excluding .dirinfo cache files)
        const proc = Bun.spawn(
          ["zip", "-r", "-q", "-x", ".dirinfo", "-x", "*/.dirinfo", "-x", "**/.dirinfo", "-", "."],
          { cwd: fullPath, stdout: "pipe" },
        );

        return new Response(proc.stdout, {
          headers: {
            "Content-Disposition": `attachment; filename="${filename}.zip"`,
            "Content-Type": "application/zip",
          },
        });
      }
    } catch {
      throw new NotFoundError("File not found", "FILE_NOT_FOUND");
    }

    // It's a file
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      throw new NotFoundError("File not found", "FILE_NOT_FOUND");
    }

    return new Response(file.stream(), {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": file.type || "application/octet-stream",
      },
    });
  })
  // Batch delete multiple files/folders
  .post("/delete-batch", async (ctx) => {
    const { paths } = await ctx.req.json<{ paths: string[] }>();
    if (!paths || !paths.length) {
      throw new ValidationError("Paths are required", "PATHS_REQUIRED");
    }

    const errors: string[] = [];
    for (const path of paths) {
      try {
        const { baseDir, relativePath } = resolvePath(path);
        if (!baseDir || !relativePath) {
          errors.push(`${path}: Cannot delete apps directory`);
          continue;
        }
        const dir = new DirInfo(baseDir, relativePath);
        await dir.delete();
      } catch (err) {
        errors.push(`${path}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    return ctx.json({ success: true, errors: errors.length ? errors : undefined });
  })
  // Batch move multiple files/folders
  .post("/move-batch", async (ctx) => {
    const { paths, destPath } = await ctx.req.json<{ destPath: string; paths: string[] }>();
    if (!paths || !paths.length) {
      throw new ValidationError("Paths are required", "PATHS_REQUIRED");
    }
    if (destPath === undefined) {
      throw new ValidationError("Destination path is required", "DEST_PATH_REQUIRED");
    }

    const dest = resolvePath(destPath);
    const errors: string[] = [];

    for (const path of paths) {
      try {
        const source = resolvePath(path);
        if (!source.baseDir || !source.relativePath) {
          errors.push(`${path}: Cannot move apps directory`);
          continue;
        }
        if (source.baseDir !== dest.baseDir) {
          errors.push(`${path}: Cannot move between different apps directories`);
          continue;
        }
        const dir = new DirInfo(source.baseDir, source.relativePath);
        await dir.move(dest.relativePath);
      } catch (err) {
        errors.push(`${path}: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    }

    return ctx.json({ success: true, errors: errors.length ? errors : undefined });
  })
  // Batch download multiple files/folders as single zip
  .get("/download-batch", async (ctx) => {
    const pathsParam = ctx.req.query("paths");
    if (!pathsParam) {
      throw new ValidationError("Paths are required", "PATHS_REQUIRED");
    }

    const paths = pathsParam
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!paths.length) {
      throw new ValidationError("Paths are required", "PATHS_REQUIRED");
    }

    // Create a temporary directory to collect files
    const tempDir = `/tmp/buntime-download-${Date.now()}`;
    await import("node:fs/promises").then((fs) => fs.mkdir(tempDir, { recursive: true }));

    try {
      // Copy all selected items to temp dir
      for (const path of paths) {
        const { baseDir, relativePath, rootName } = resolvePath(path);
        if (!baseDir) continue;

        const fullPath = relativePath ? join(baseDir, relativePath) : baseDir;
        const name = relativePath ? relativePath.split("/").pop() || rootName : rootName;
        const destPath = join(tempDir, name);

        const proc = Bun.spawn(["cp", "-r", fullPath, destPath]);
        await proc.exited;
      }

      // Zip the temp directory (excluding .dirinfo)
      const proc = Bun.spawn(
        ["zip", "-r", "-q", "-x", ".dirinfo", "-x", "*/.dirinfo", "-x", "**/.dirinfo", "-", "."],
        { cwd: tempDir, stdout: "pipe" },
      );

      const response = new Response(proc.stdout, {
        headers: {
          "Content-Disposition": `attachment; filename="download-${Date.now()}.zip"`,
          "Content-Type": "application/zip",
        },
      });

      // Cleanup temp dir after streaming (fire and forget)
      proc.exited.then(() => {
        Bun.spawn(["rm", "-rf", tempDir]);
      });

      return response;
    } catch {
      // Cleanup on error
      Bun.spawn(["rm", "-rf", tempDir]);
      throw new ValidationError("Failed to create download", "DOWNLOAD_FAILED");
    }
  })
  .onError((err) => {
    console.error(`[Deployments] Error:`, err);
    return errorToResponse(err);
  });

export type DeploymentsRoutesType = typeof api;
