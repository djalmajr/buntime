import { join } from "node:path";
import { NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { DirInfo } from "@/libs/dir-info";

export interface RegistryRef {
  checkRouteConflict: (path: string) => string | undefined;
  getMountedPaths: () => Map<string, string>;
  getReservedPaths: () => Map<string, string>;
}

export interface DeploymentRoutesDeps {
  appsDir: string;
  registry?: RegistryRef;
}

export type DeploymentRoutesType = ReturnType<typeof createDeploymentRoutes>;

export function createDeploymentRoutes({ appsDir, registry }: DeploymentRoutesDeps) {
  /**
   * Check if app name conflicts with plugin routes or reserved paths
   * Throws ValidationError if there's a conflict
   */
  function checkAppConflict(appName: string): void {
    if (!registry) return;

    const appPath = `/${appName}`;

    // 1. Check plugin routes (mounted paths like /api/authn)
    const conflictingPlugin = registry.checkRouteConflict(appPath);
    if (conflictingPlugin) {
      throw new ValidationError(
        `App name "${appName}" conflicts with plugin "${conflictingPlugin}". Choose a different name.`,
        "APP_NAME_CONFLICT",
      );
    }

    // 2. Check plugin-registered apps (reserved paths)
    const reservedPaths = registry.getReservedPaths();
    if (reservedPaths.has(appPath)) {
      const pluginName = reservedPaths.get(appPath);
      throw new ValidationError(
        `App name "${appName}" is reserved by plugin "${pluginName}". Choose a different name.`,
        "APP_NAME_RESERVED",
      );
    }
  }

  return (
    new Hono()
      // List directory contents
      .get("/list", async (ctx) => {
        const path = ctx.req.query("path") || "";
        const dir = new DirInfo(appsDir, path);
        const entries = await dir.list();
        return ctx.json({ success: true, data: { entries, path } });
      })

      // Create new directory
      .post("/mkdir", async (ctx) => {
        const { path } = await ctx.req.json<{ path: string }>();
        if (!path) {
          throw new ValidationError("Path is required", "PATH_REQUIRED");
        }

        // Check for plugin route conflicts (only for top-level app directories)
        const appName = path.split("/")[0];
        if (appName) checkAppConflict(appName);

        const dir = new DirInfo(appsDir, path);
        await dir.create();
        return ctx.json({ success: true });
      })

      // Delete file or directory
      .delete("/delete", async (ctx) => {
        const { path } = await ctx.req.json<{ path: string }>();
        if (!path) {
          throw new ValidationError("Path is required", "PATH_REQUIRED");
        }
        if (path === "" || path === "/") {
          throw new ValidationError("Cannot delete root directory", "CANNOT_DELETE_ROOT");
        }
        const dir = new DirInfo(appsDir, path);
        await dir.delete();
        return ctx.json({ success: true });
      })

      // Rename file or directory
      .post("/rename", async (ctx) => {
        const { path, newName } = await ctx.req.json<{ newName: string; path: string }>();
        if (!path || !newName) {
          throw new ValidationError("Path and newName are required", "PATH_AND_NAME_REQUIRED");
        }
        const dir = new DirInfo(appsDir, path);
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
        const dir = new DirInfo(appsDir, path);
        await dir.move(destPath);
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

        // Check for plugin route conflicts (only for top-level app directories)
        const appName = targetPath.split("/")[0];
        if (appName) checkAppConflict(appName);

        const dir = new DirInfo(appsDir, targetPath);

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file) continue;

          const relativePath = paths[i] || file.name;
          const content = await file.arrayBuffer();

          if (file.name.endsWith(".zip")) {
            await dir.extractZip(content);
          } else {
            await dir.writeFile(relativePath, content);
          }
        }

        return ctx.json({ success: true });
      })

      // Refresh cache (invalidate .dirinfo)
      .get("/refresh", async (ctx) => {
        const path = ctx.req.query("path") || "";
        const dir = new DirInfo(appsDir, path);
        await dir.refresh();
        return ctx.json({ success: true });
      })
      .post("/refresh", async (ctx) => {
        const { path } = await ctx.req.json<{ path?: string }>();
        const dir = new DirInfo(appsDir, path || "");
        await dir.refresh();
        return ctx.json({ success: true });
      })

      // Download file or folder (folders are zipped)
      .get("/download", async (ctx) => {
        const path = ctx.req.query("path");
        if (!path) {
          throw new ValidationError("Path is required", "PATH_REQUIRED");
        }

        const fullPath = join(appsDir, path);
        const filename = path.split("/").pop() || "file";

        // Check if it's a directory
        try {
          const stats = await import("node:fs/promises").then((fs) => fs.stat(fullPath));

          if (stats.isDirectory()) {
            // Zip the directory and stream it (excluding .dirinfo cache files)
            const proc = Bun.spawn(
              [
                "zip",
                "-r",
                "-q",
                "-x",
                ".dirinfo",
                "-x",
                "*/.dirinfo",
                "-x",
                "**/.dirinfo",
                "-",
                ".",
              ],
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
          if (path === "" || path === "/") continue;
          try {
            const dir = new DirInfo(appsDir, path);
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

        const errors: string[] = [];
        for (const path of paths) {
          try {
            const dir = new DirInfo(appsDir, path);
            await dir.move(destPath);
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
            const fullPath = join(appsDir, path);
            const name = path.split("/").pop() || "item";
            const destPath = join(tempDir, name);

            const proc = Bun.spawn(["cp", "-r", fullPath, destPath]);
            await proc.exited;
          }

          // Zip the temp directory (excluding .dirinfo)
          const proc = Bun.spawn(
            [
              "zip",
              "-r",
              "-q",
              "-x",
              ".dirinfo",
              "-x",
              "*/.dirinfo",
              "-x",
              "**/.dirinfo",
              "-",
              ".",
            ],
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
  );
}
