import { join } from "node:path";
import { NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { APPS_DIR } from "~/constants";
import { DirInfo } from "~/libs/dir-info";

interface RegistryRef {
  checkRouteConflict: (path: string) => string | undefined;
  getMountedPaths: () => Map<string, string>;
}

// Registry is set after app initialization
let registryRef: RegistryRef | null = null;

/**
 * Set the plugin registry reference for conflict detection
 */
export function setRegistry(registry: RegistryRef) {
  registryRef = registry;
}

/**
 * Check if an app name conflicts with a plugin route and log warning
 */
function checkAppConflict(appName: string): void {
  if (!registryRef) return;

  const appPath = `/${appName}`;
  const conflictingPlugin = registryRef.checkRouteConflict(appPath);

  if (conflictingPlugin) {
    // Find the actual mount path of the conflicting plugin
    const mountedPaths = registryRef.getMountedPaths();
    let pluginMountPath = "";
    for (const [path, name] of mountedPaths) {
      if (name === conflictingPlugin) {
        pluginMountPath = path;
        break;
      }
    }

    console.warn(
      `[Warning] App "${appName}" conflicts with plugin "${conflictingPlugin}" ` +
        `(mounted at "${pluginMountPath}"). Plugin routes take priority.`,
    );
  }
}

export default new Hono()
  // List directory contents
  .get("/list", async (ctx) => {
    const path = ctx.req.query("path") || "";
    const dir = new DirInfo(APPS_DIR, path);
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

    const dir = new DirInfo(APPS_DIR, path);
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
    const dir = new DirInfo(APPS_DIR, path);
    await dir.delete();
    return ctx.json({ success: true });
  })

  // Rename file or directory
  .post("/rename", async (ctx) => {
    const { path, newName } = await ctx.req.json<{ newName: string; path: string }>();
    if (!path || !newName) {
      throw new ValidationError("Path and newName are required", "PATH_AND_NAME_REQUIRED");
    }
    const dir = new DirInfo(APPS_DIR, path);
    await dir.rename(newName);
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

    // Check for plugin route conflicts (only for top-level app directories)
    const appName = targetPath.split("/")[0];
    if (appName) checkAppConflict(appName);

    const dir = new DirInfo(APPS_DIR, targetPath);

    for (const file of files) {
      const content = await file.arrayBuffer();

      if (file.name.endsWith(".zip")) {
        await dir.extractZip(content);
      } else {
        await dir.writeFile(file.name, content);
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
