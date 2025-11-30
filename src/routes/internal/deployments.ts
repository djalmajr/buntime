import { join } from "node:path";
import { Hono } from "hono";
import { APPS_DIR } from "@/constants";
import { NotFoundError, ValidationError } from "@/libs/errors";

interface FileEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  const glob = new Bun.Glob("**/*");

  try {
    for await (const filePath of glob.scan({ cwd: dirPath, onlyFiles: true })) {
      const file = Bun.file(join(dirPath, filePath));
      if (await file.exists()) {
        totalSize += file.size;
      }
    }
  } catch {
    // Ignore errors
  }

  return totalSize;
}

async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const fullPath = join(APPS_DIR, dirPath);
  const entries: FileEntry[] = [];

  try {
    const glob = new Bun.Glob("*");
    for await (const name of glob.scan({ cwd: fullPath, onlyFiles: false })) {
      const entryPath = join(fullPath, name);
      const file = Bun.file(entryPath);
      const stat = (await file.exists()) ? { size: file.size } : null;

      // Check if it's a directory by trying to read it
      let isDirectory = false;
      try {
        const testGlob = new Bun.Glob("*");
        // If we can scan it, it's a directory
        for await (const _ of testGlob.scan({
          cwd: entryPath,
          onlyFiles: false,
        })) {
          isDirectory = true;
          break;
        }
        // Empty directories are still directories
        if (!stat) isDirectory = true;
      } catch {
        isDirectory = false;
      }

      const relativePath = dirPath ? `${dirPath}/${name}` : name;

      // Calculate size: for directories, sum all files recursively
      const size = isDirectory ? await getDirectorySize(entryPath) : (stat?.size ?? 0);

      entries.push({
        isDirectory,
        name,
        path: relativePath,
        size,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch {
    // Directory doesn't exist or can't be read
    return [];
  }

  // Sort: directories first, then by name
  return entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

async function createDirectory(dirPath: string): Promise<void> {
  const fullPath = join(APPS_DIR, dirPath);
  await Bun.write(join(fullPath, ".keep"), "");
  // Remove .keep file after directory is created
  const keepFile = Bun.file(join(fullPath, ".keep"));
  if (await keepFile.exists()) {
    await Bun.write(join(fullPath, ".keep"), "").then(() => {
      // Directory is now created, we can leave .keep or remove it
    });
  }
}

async function deleteEntry(entryPath: string): Promise<void> {
  const fullPath = join(APPS_DIR, entryPath);
  const file = Bun.file(fullPath);

  if (await file.exists()) {
    // It's a file
    await file.unlink();
  } else {
    // It's a directory - use rm -rf via shell
    const proc = Bun.spawn(["rm", "-rf", fullPath]);
    await proc.exited;
  }
}

async function renameEntry(oldPath: string, newName: string): Promise<void> {
  const fullOldPath = join(APPS_DIR, oldPath);
  const parentDir = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
  const fullNewPath = join(APPS_DIR, parentDir, newName);

  const proc = Bun.spawn(["mv", fullOldPath, fullNewPath]);
  await proc.exited;
}

async function extractZip(zipBuffer: ArrayBuffer, targetDir: string): Promise<void> {
  const fullPath = join(APPS_DIR, targetDir);
  const tempZip = join(fullPath, ".temp-upload.zip");

  // Write ZIP to temp file
  await Bun.write(tempZip, zipBuffer);

  // Extract using unzip command
  const proc = Bun.spawn(["unzip", "-o", "-q", tempZip, "-d", fullPath]);
  await proc.exited;

  // Remove temp file
  const tempFile = Bun.file(tempZip);
  if (await tempFile.exists()) {
    await tempFile.unlink();
  }
}

async function writeFile(filePath: string, content: ArrayBuffer | string): Promise<void> {
  const fullPath = join(APPS_DIR, filePath);
  await Bun.write(fullPath, content);
}

export default new Hono()
  // List directory contents
  .get("/list", async (ctx) => {
    const path = ctx.req.query("path") || "";
    const entries = await listDirectory(path);
    return ctx.json({ success: true, data: { entries, path } });
  })

  // Create new directory
  .post("/mkdir", async (ctx) => {
    const { path } = await ctx.req.json<{ path: string }>();
    if (!path) {
      throw new ValidationError("Path is required", "PATH_REQUIRED");
    }
    await createDirectory(path);
    return ctx.json({ success: true });
  })

  // Delete file or directory
  .delete("/delete", async (ctx) => {
    const { path } = await ctx.req.json<{ path: string }>();
    if (!path) {
      throw new ValidationError("Path is required", "PATH_REQUIRED");
    }
    // Prevent deleting root
    if (path === "" || path === "/") {
      throw new ValidationError("Cannot delete root directory", "CANNOT_DELETE_ROOT");
    }
    await deleteEntry(path);
    return ctx.json({ success: true });
  })

  // Rename file or directory
  .post("/rename", async (ctx) => {
    const { path, newName } = await ctx.req.json<{
      newName: string;
      path: string;
    }>();
    if (!path || !newName) {
      throw new ValidationError("Path and newName are required", "PATH_AND_NAME_REQUIRED");
    }
    await renameEntry(path, newName);
    return ctx.json({ success: true });
  })

  // Upload files
  .post("/upload", async (ctx) => {
    const formData = await ctx.req.formData();
    const targetPath = (formData.get("path") as string) || "";
    const files = formData.getAll("files") as File[];

    if (!files.length) {
      throw new ValidationError("No files provided", "NO_FILES_PROVIDED");
    }

    for (const file of files) {
      const content = await file.arrayBuffer();

      if (file.name.endsWith(".zip")) {
        // Extract ZIP file
        await extractZip(content, targetPath);
      } else {
        // Write regular file
        const filePath = targetPath ? `${targetPath}/${file.name}` : file.name;
        await writeFile(filePath, content);
      }
    }

    return ctx.json({ success: true });
  })

  // Download file
  .get("/download", async (ctx) => {
    const path = ctx.req.query("path");
    if (!path) {
      throw new ValidationError("Path is required", "PATH_REQUIRED");
    }

    const fullPath = join(APPS_DIR, path);
    const file = Bun.file(fullPath);

    if (!(await file.exists())) {
      throw new NotFoundError("File not found", "FILE_NOT_FOUND");
    }

    const filename = path.split("/").pop() || "file";
    return new Response(file.stream(), {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": file.type || "application/octet-stream",
      },
    });
  });
