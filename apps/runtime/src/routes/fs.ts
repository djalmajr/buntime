/**
 * @module
 * Generic file-browser routes mounted under `/api/workers/files` and
 * `/api/plugins/files`. Both mounts share the same handlers but receive
 * different `resolveDirs()` providers and `PathPolicy` instances so the same
 * UI works against either resource type.
 *
 * The factory does NOT mount any auth middleware — the runtime's API gate at
 * `apps/runtime/src/app.ts` already authenticates the cookie/header credential
 * before this surface is reached, and `requiredPermissionForApiRoute()` adds
 * the per-route permission checks.
 *
 * Ported from `plugins/plugin-deployments/server/api.ts`; behaviour preserved.
 */

import { basename, join } from "node:path";
import {
  errorToResponse,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@buntime/shared/errors";
import { splitList } from "@buntime/shared/utils/string";
import { Hono } from "hono";
import { type ApiKeyPrincipal, principalCanAccessNamespace } from "@/libs/api-keys";
import { DirInfo } from "@/libs/fs/dir-info";
import type { PathPolicy } from "@/libs/fs/path-policies";

const DEFAULT_EXCLUDES = [".git", "node_modules"];

/**
 * Namespace implied by a file-browser path (`<mount>/<unit>/...`): the second
 * segment when it is an `@scope`. A path that does not descend into a specific
 * unit (root or mount level) yields `undefined`, so list output is filtered
 * per entry instead of being blocked outright.
 */
function namespaceFromBrowserPath(path: string): string | null | undefined {
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  const unit = segments[1] ?? "";
  return unit.startsWith("@") ? unit : null;
}

/**
 * Whether a principal may act on a file-browser path. Root, `*` keys, and
 * root/mount-level paths (no specific unit) always pass — the latter are
 * filtered per entry by {@link filterEntriesByNamespace} instead.
 */
function canAccessBrowserPath(principal: ApiKeyPrincipal | undefined, path: string): boolean {
  if (!principal || principal.isRoot) return true;
  const ns = namespaceFromBrowserPath(path);
  if (ns === undefined) return true;
  return principalCanAccessNamespace(principal, ns);
}

/** Throw `403` when a non-root principal targets a namespace it cannot access. */
function guardBrowserNamespace(principal: ApiKeyPrincipal | undefined, path: string): void {
  if (canAccessBrowserPath(principal, path)) return;
  const ns = namespaceFromBrowserPath(path);
  throw new ForbiddenError(
    ns ? `Access denied for namespace: ${ns}` : "Access denied for unscoped resources",
    "NAMESPACE_DENIED",
  );
}

/** Hide list entries whose namespace the principal cannot access. */
function filterEntriesByNamespace<T extends { path: string }>(
  entries: T[],
  principal: ApiKeyPrincipal | undefined,
): T[] {
  if (!principal || principal.isRoot) return entries;
  return entries.filter((entry) => {
    const ns = namespaceFromBrowserPath(entry.path);
    if (ns === undefined) return true;
    return principalCanAccessNamespace(principal, ns);
  });
}

export interface FsRoutesOptions {
  /**
   * Returns the list of physical roots backing this mount. Re-evaluated per
   * request so hot-reload of runtime config is picked up.
   */
  resolveDirs: () => string[];
  /** Path policy (workers / plugins / custom). */
  pathPolicy: PathPolicy;
  /** Extra excludes layered on top of `.git`/`node_modules` defaults. */
  excludes?: string[];
}

interface ResolvedPath {
  baseDir: string;
  relativePath: string;
  rootName: string;
}

function buildDirNameMap(dirs: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const nameCounts: Record<string, number> = {};

  for (const dir of dirs) {
    let name = basename(dir);
    const count = (nameCounts[name] || 0) + 1;
    nameCounts[name] = count;
    if (count > 1) name = `${name}-${count}`;
    // Hidden mount roots (starting with ".") are served but not listed.
    if (!name.startsWith(".")) {
      map.set(name, dir);
    }
  }
  return map;
}

/**
 * Build a `createFsRoutes` factory.
 *
 * The returned Hono router exposes the file-browser endpoints under whatever
 * base path the caller mounts it at. Endpoints are:
 *
 * - `GET    /list?path=`
 * - `POST   /mkdir`
 * - `DELETE /delete`
 * - `POST   /rename`
 * - `POST   /move`
 * - `POST   /upload`
 * - `GET    /refresh?path=` / `POST /refresh`
 * - `GET    /download?path=`
 * - `POST   /delete-batch`
 * - `POST   /move-batch`
 * - `GET    /download-batch?paths=`
 */
export function createFsRoutes(opts: FsRoutesOptions) {
  const { pathPolicy, resolveDirs } = opts;
  const excludes = [...new Set([...DEFAULT_EXCLUDES, ...(opts.excludes ?? [])])];

  // Apply excludes to the shared DirInfo static. Because two mounts share this
  // static, we union over the lifetime of the process — last-write-wins per
  // exclude, which is OK because both mounts default to the same list.
  DirInfo.globalExcludes = [...new Set([...DirInfo.globalExcludes, ...excludes])];

  function resolvePath(path: string): ResolvedPath {
    if (!path || path === "/") {
      return { baseDir: "", relativePath: "", rootName: "" };
    }
    const dirNameMap = buildDirNameMap(resolveDirs());
    const parts = path.split("/");
    const rootName = parts[0] ?? "";
    const relativePath = parts.slice(1).join("/");

    const baseDir = dirNameMap.get(rootName);
    if (!baseDir) {
      throw new NotFoundError(`Directory not found: ${rootName}`, "DIR_NOT_FOUND");
    }
    return { baseDir, relativePath, rootName };
  }

  function dirOf(baseDir: string, relativePath: string): DirInfo {
    return new DirInfo(baseDir, relativePath, pathPolicy);
  }

  const router = new Hono()
    .get("/list", async (ctx) => {
      const path = ctx.req.query("path") || "";

      // Root listing — show all mount roots as folders.
      if (!path || path === "/") {
        const dirNameMap = buildDirNameMap(resolveDirs());
        const entries: Array<{
          isDirectory: boolean;
          modifiedAt: string;
          name: string;
          path: string;
          size: number;
        }> = [];
        const fs = await import("node:fs/promises");
        for (const [name, fullPath] of dirNameMap) {
          try {
            const stats = await fs.stat(fullPath);
            entries.push({
              isDirectory: true,
              modifiedAt: stats.mtime.toISOString(),
              name,
              path: name,
              size: 0,
            });
          } catch {
            entries.push({
              isDirectory: true,
              modifiedAt: new Date().toISOString(),
              name,
              path: name,
              size: 0,
            });
          }
        }
        return ctx.json({ data: { entries, path: "" }, success: true });
      }

      guardBrowserNamespace(ctx.get("principal"), path);
      const { baseDir, relativePath, rootName } = resolvePath(path);
      const dir = dirOf(baseDir, relativePath);
      const rawEntries = await dir.list();
      const entries = filterEntriesByNamespace(
        rawEntries
          .filter((entry) => entry.visibility !== "internal")
          .map((entry) => ({
            ...entry,
            path: rootName + (entry.path ? `/${entry.path}` : `/${entry.name}`),
          })),
        ctx.get("principal"),
      );
      const currentVisibility = await dir.getVisibility();
      return ctx.json({ data: { currentVisibility, entries, path }, success: true });
    })
    .post("/mkdir", async (ctx) => {
      const { path } = await ctx.req.json<{ path: string }>();
      if (!path) throw new ValidationError("Path is required", "PATH_REQUIRED");
      guardBrowserNamespace(ctx.get("principal"), path);

      const { baseDir, relativePath } = resolvePath(path);
      if (!baseDir) {
        throw new ValidationError("Cannot create directory at root level", "CANNOT_CREATE_AT_ROOT");
      }

      await dirOf(baseDir, relativePath).create();
      return ctx.json({ success: true });
    })
    .delete("/delete", async (ctx) => {
      const { path } = await ctx.req.json<{ path: string }>();
      if (!path) throw new ValidationError("Path is required", "PATH_REQUIRED");
      guardBrowserNamespace(ctx.get("principal"), path);

      const { baseDir, relativePath, rootName } = resolvePath(path);
      if (!baseDir) {
        throw new ValidationError("Cannot delete root directory", "CANNOT_DELETE_ROOT");
      }
      if (!relativePath) {
        throw new ValidationError(`Cannot delete root: ${rootName}`, "CANNOT_DELETE_ROOT");
      }

      await dirOf(baseDir, relativePath).delete();
      return ctx.json({ success: true });
    })
    .post("/rename", async (ctx) => {
      const { newName, path } = await ctx.req.json<{ newName: string; path: string }>();
      if (!path || !newName) {
        throw new ValidationError("Path and newName are required", "PATH_AND_NAME_REQUIRED");
      }
      guardBrowserNamespace(ctx.get("principal"), path);

      const { baseDir, relativePath, rootName } = resolvePath(path);
      if (!baseDir || !relativePath) {
        throw new ValidationError(`Cannot rename root: ${rootName}`, "CANNOT_RENAME_ROOT");
      }

      await dirOf(baseDir, relativePath).rename(newName);
      return ctx.json({ success: true });
    })
    .post("/move", async (ctx) => {
      const { destPath, path } = await ctx.req.json<{ destPath: string; path: string }>();
      if (!path) throw new ValidationError("Path is required", "PATH_REQUIRED");
      if (destPath === undefined) {
        throw new ValidationError("Destination path is required", "DEST_PATH_REQUIRED");
      }
      const movePrincipal = ctx.get("principal");
      guardBrowserNamespace(movePrincipal, path);
      guardBrowserNamespace(movePrincipal, destPath);

      const source = resolvePath(path);
      const dest = resolvePath(destPath || source.rootName);

      if (!source.baseDir || !source.relativePath) {
        throw new ValidationError("Cannot move root directory", "CANNOT_MOVE_ROOT");
      }
      if (source.baseDir !== dest.baseDir) {
        throw new ValidationError(
          "Cannot move between different mount roots",
          "CROSS_DIR_MOVE_NOT_SUPPORTED",
        );
      }

      await dirOf(source.baseDir, source.relativePath).move(dest.relativePath);
      return ctx.json({ success: true });
    })
    .post("/upload", async (ctx) => {
      const formData = await ctx.req.formData();
      const targetPath = (formData.get("path") as string) || "";
      const files = formData.getAll("files") as File[];
      const paths = formData.getAll("paths") as string[];

      if (!files.length) {
        throw new ValidationError("No files provided", "NO_FILES_PROVIDED");
      }
      guardBrowserNamespace(ctx.get("principal"), targetPath);

      const { baseDir, relativePath } = resolvePath(targetPath);
      if (!baseDir) {
        throw new ValidationError("Cannot upload to root level", "CANNOT_UPLOAD_TO_ROOT");
      }

      // Surface-specific upload policy. Workers reject uploads outside a
      // version folder; plugins accept anything at or below the plugin root.
      if (!pathPolicy.canWriteAt(relativePath)) {
        throw new ValidationError(
          `Upload target is not a writable location for the ${pathPolicy.name} surface`,
          "UPLOAD_TARGET_INVALID",
        );
      }

      const dir = dirOf(baseDir, relativePath);

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
    .get("/refresh", async (ctx) => {
      const path = ctx.req.query("path") || "";
      guardBrowserNamespace(ctx.get("principal"), path);
      const { baseDir, relativePath } = resolvePath(path);

      if (!baseDir) {
        for (const dir of resolveDirs()) {
          await dirOf(dir, "").refresh();
        }
      } else {
        await dirOf(baseDir, relativePath).refresh();
      }
      return ctx.json({ success: true });
    })
    .post("/refresh", async (ctx) => {
      const { path } = await ctx.req.json<{ path?: string }>();
      guardBrowserNamespace(ctx.get("principal"), path || "");
      const { baseDir, relativePath } = resolvePath(path || "");

      if (!baseDir) {
        for (const dir of resolveDirs()) {
          await dirOf(dir, "").refresh();
        }
      } else {
        await dirOf(baseDir, relativePath).refresh();
      }
      return ctx.json({ success: true });
    })
    .get("/download", async (ctx) => {
      const path = ctx.req.query("path");
      if (!path) throw new ValidationError("Path is required", "PATH_REQUIRED");
      guardBrowserNamespace(ctx.get("principal"), path);

      const { baseDir, relativePath, rootName } = resolvePath(path);
      if (!baseDir) {
        throw new ValidationError("Cannot download root", "CANNOT_DOWNLOAD_ROOT");
      }

      const fullPath = relativePath ? join(baseDir, relativePath) : baseDir;
      const filename = relativePath ? relativePath.split("/").pop() || rootName : rootName;

      try {
        const fs = await import("node:fs/promises");
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
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
    .post("/delete-batch", async (ctx) => {
      const { paths } = await ctx.req.json<{ paths: string[] }>();
      if (!paths || !paths.length) {
        throw new ValidationError("Paths are required", "PATHS_REQUIRED");
      }

      const deletePrincipal = ctx.get("principal");
      const errors: string[] = [];
      for (const path of paths) {
        try {
          guardBrowserNamespace(deletePrincipal, path);
          const { baseDir, relativePath } = resolvePath(path);
          if (!baseDir || !relativePath) {
            errors.push(`${path}: Cannot delete root`);
            continue;
          }
          await dirOf(baseDir, relativePath).delete();
        } catch (err) {
          errors.push(`${path}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      return ctx.json({ errors: errors.length ? errors : undefined, success: true });
    })
    .post("/move-batch", async (ctx) => {
      const { destPath, paths } = await ctx.req.json<{ destPath: string; paths: string[] }>();
      if (!paths || !paths.length) {
        throw new ValidationError("Paths are required", "PATHS_REQUIRED");
      }
      if (destPath === undefined) {
        throw new ValidationError("Destination path is required", "DEST_PATH_REQUIRED");
      }

      const movePrincipal = ctx.get("principal");
      guardBrowserNamespace(movePrincipal, destPath);
      const dest = resolvePath(destPath);
      const errors: string[] = [];

      for (const path of paths) {
        try {
          guardBrowserNamespace(movePrincipal, path);
          const source = resolvePath(path);
          if (!source.baseDir || !source.relativePath) {
            errors.push(`${path}: Cannot move root`);
            continue;
          }
          if (source.baseDir !== dest.baseDir) {
            errors.push(`${path}: Cannot move between different mount roots`);
            continue;
          }
          await dirOf(source.baseDir, source.relativePath).move(dest.relativePath);
        } catch (err) {
          errors.push(`${path}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
      }

      return ctx.json({ errors: errors.length ? errors : undefined, success: true });
    })
    .get("/download-batch", async (ctx) => {
      const pathsParam = ctx.req.query("paths");
      if (!pathsParam) {
        throw new ValidationError("Paths are required", "PATHS_REQUIRED");
      }

      const paths = splitList(pathsParam);
      if (!paths.length) {
        throw new ValidationError("Paths are required", "PATHS_REQUIRED");
      }

      const fs = await import("node:fs/promises");
      const tempDir = `/tmp/buntime-download-${Date.now()}`;
      await fs.mkdir(tempDir, { recursive: true });

      const downloadPrincipal = ctx.get("principal");
      try {
        let copiedCount = 0;
        for (const path of paths) {
          if (!canAccessBrowserPath(downloadPrincipal, path)) continue;
          const { baseDir, relativePath, rootName } = resolvePath(path);
          if (!baseDir) continue;

          const fullPath = relativePath ? join(baseDir, relativePath) : baseDir;
          const name = relativePath ? relativePath.split("/").pop() || rootName : rootName;
          const destPath = join(tempDir, name);

          try {
            await fs.access(fullPath);
          } catch {
            console.warn(`[fs] Download batch: path not found: ${fullPath}`);
            continue;
          }

          const proc = Bun.spawn(["cp", "-r", fullPath, destPath], { stderr: "pipe" });
          const exitCode = await proc.exited;

          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            console.error(`[fs] cp failed for ${path}: ${stderr}`);
            continue;
          }
          copiedCount++;
        }

        if (copiedCount === 0) {
          throw new NotFoundError("No valid paths to download", "NO_VALID_PATHS");
        }

        const proc = Bun.spawn(
          ["zip", "-r", "-q", "-x", ".dirinfo", "-x", "*/.dirinfo", "-x", "**/.dirinfo", "-", "."],
          { cwd: tempDir, stdout: "pipe", stderr: "pipe" },
        );

        const response = new Response(proc.stdout, {
          headers: {
            "Content-Disposition": `attachment; filename="download-${Date.now()}.zip"`,
            "Content-Type": "application/zip",
          },
        });

        proc.exited.then((exitCode: number) => {
          if (exitCode !== 0) console.error(`[fs] zip failed with exit code ${exitCode}`);
          Bun.spawn(["rm", "-rf", tempDir]);
        });

        return response;
      } catch (err) {
        Bun.spawn(["rm", "-rf", tempDir]);
        if (err instanceof NotFoundError || err instanceof ValidationError) {
          throw err;
        }
        console.error("[fs] Download batch failed:", err);
        throw new ValidationError(
          err instanceof Error ? err.message : "Failed to create download",
          "DOWNLOAD_FAILED",
        );
      }
    })
    .onError((err) => {
      console.error("[fs] Error:", err);
      return errorToResponse(err);
    });

  return router;
}

export type FsRoutesType = ReturnType<typeof createFsRoutes>;
