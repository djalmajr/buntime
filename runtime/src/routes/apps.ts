/**
 * Apps API Routes (/api/apps)
 *
 * Provides app management endpoints for:
 * - Listing installed apps
 * - Uploading new apps (tarball or zip)
 * - Removing apps
 *
 * This API is always available in the runtime (solves bootstrap problem).
 * Apps are identified by being in workerDirs (not by manifest content).
 *
 * Authorization:
 * - apps:read permission: Can list installed apps
 * - apps:install permission: Can upload new apps
 * - apps:remove permission: Can delete apps
 */

import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { ForbiddenError, NotFoundError, ValidationError } from "@buntime/shared/errors";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "@/config";
import { hasPermission, type Permission, type ValidatedKey } from "@/libs/api-keys";
import { logAppInstall, logAppRemove } from "@/libs/audit";
import type { AppEnv } from "@/libs/hono-context";
import { AppInfoSchema, AuthHeader, CommonErrors, SuccessResponse } from "@/libs/openapi";
import {
  createTempDir,
  detectArchiveFormat,
  directoryExists,
  extractArchive,
  getInstallPath,
  isPathSafe,
  parsePackageName,
  readPackageInfo,
  removeDirectory,
} from "@/libs/registry/packager";

/**
 * App info for API responses
 */
interface AppInfo {
  name: string;
  path: string;
  versions: string[];
}

/**
 * List all installed apps from workerDirs
 */
async function listInstalledApps(): Promise<AppInfo[]> {
  const { workerDirs } = getConfig();
  const apps: AppInfo[] = [];

  for (const workerDir of workerDirs) {
    if (!(await directoryExists(workerDir))) continue;

    const entries = await readdir(workerDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      const fullPath = join(workerDir, name);

      if (name.startsWith("@")) {
        // Scoped package: @scope/name/version
        const scopeDir = fullPath;
        const scopeEntries = await readdir(scopeDir, { withFileTypes: true });

        for (const scopeEntry of scopeEntries) {
          if (!scopeEntry.isDirectory()) continue;

          const packagePath = join(scopeDir, scopeEntry.name);
          const versions = await getVersions(packagePath);

          if (versions.length > 0) {
            apps.push({
              name: `${name}/${scopeEntry.name}`,
              path: packagePath,
              versions,
            });
          }
        }
      } else {
        // Unscoped package or flat format: check if it contains versions
        const versions = await getVersions(fullPath);

        if (versions.length > 0) {
          apps.push({
            name,
            path: fullPath,
            versions,
          });
        } else {
          // Flat format: app@version or simple folder
          // Check if it's a valid app folder (has package.json or index.ts)
          const hasPackageJson = await Bun.file(join(fullPath, "package.json")).exists();
          const hasIndex = await Bun.file(join(fullPath, "index.ts")).exists();

          if (hasPackageJson || hasIndex) {
            // Extract version from folder name if it's app@version format
            const atIndex = name.indexOf("@");
            if (atIndex > 0) {
              const appName = name.slice(0, atIndex);
              const version = name.slice(atIndex + 1);
              const existingApp = apps.find((a) => a.name === appName);

              if (existingApp) {
                existingApp.versions.push(version);
              } else {
                apps.push({
                  name: appName,
                  path: workerDir,
                  versions: [version],
                });
              }
            } else {
              // Simple folder without version
              apps.push({
                name,
                path: fullPath,
                versions: ["latest"],
              });
            }
          }
        }
      }
    }
  }

  return apps;
}

/**
 * Get version directories from a package path
 */
async function getVersions(packagePath: string): Promise<string[]> {
  try {
    const entries = await readdir(packagePath, { withFileTypes: true });
    const versions = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);

    // Filter valid version directories (must have index.ts or package.json)
    const validVersions: string[] = [];
    for (const version of versions) {
      const versionPath = join(packagePath, version);
      const hasPackageJson = await Bun.file(join(versionPath, "package.json")).exists();
      const hasIndex = await Bun.file(join(versionPath, "index.ts")).exists();

      if (hasPackageJson || hasIndex) {
        validVersions.push(version);
      }
    }

    return validVersions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // Latest first
  } catch {
    return [];
  }
}

/**
 * Get validated key from Hono context
 */
function getValidatedKey(ctx: Context): ValidatedKey | null {
  return (ctx as Context<AppEnv>).get("validatedKey");
}

/**
 * Require a validated key with specific permission
 */
function requirePermission(c: Context, permission: Permission): ValidatedKey {
  const key = getValidatedKey(c);

  if (!key) {
    throw new ForbiddenError("Authentication required", "AUTH_REQUIRED");
  }

  if (!hasPermission(key, permission)) {
    throw new ForbiddenError(`Permission denied: ${permission}`, "PERMISSION_DENIED");
  }

  return key;
}

/**
 * Create apps core routes
 */
export function createAppsRoutes() {
  return new Hono()
    .get(
      "/",
      describeRoute({
        tags: ["Apps"],
        summary: "List installed apps",
        description: "Returns all apps installed in workerDirs",
        parameters: [AuthHeader],
        responses: {
          200: {
            description: "List of installed apps",
            content: {
              "application/json": {
                schema: { type: "array", items: AppInfoSchema },
              },
            },
          },
          ...CommonErrors,
        },
      }),
      async (ctx) => {
        requirePermission(ctx, "apps:read");
        const apps = await listInstalledApps();
        return ctx.json(apps);
      },
    )
    .post(
      "/upload",
      describeRoute({
        tags: ["Apps"],
        summary: "Upload app",
        description: "Upload a new app (tarball or zip)",
        parameters: [AuthHeader],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: "App archive (.tgz, .tar.gz, or .zip)",
                  },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "App uploaded successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        app: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            version: { type: "string" },
                            installedAt: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          ...CommonErrors,
        },
      }),
      async (ctx) => {
        const actor = requirePermission(ctx, "apps:install");
        const { workerDirs } = getConfig();

        if (workerDirs.length === 0) {
          throw new ValidationError("No workerDirs configured", "NO_WORKER_DIRS");
        }

        // Get form data
        const formData = await ctx.req.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
          throw new ValidationError("No file provided", "NO_FILE_PROVIDED");
        }

        // Detect archive format
        const format = detectArchiveFormat(file.name);
        if (!format) {
          throw new ValidationError("File must be .tgz, .tar.gz, or .zip", "INVALID_FILE_TYPE");
        }

        // Extract to temp directory
        const tempDir = await createTempDir();

        try {
          await extractArchive(file, tempDir, format);

          // Read package info (only name and version)
          const packageInfo = await readPackageInfo(tempDir);

          // Use first workerDir as installation target
          const targetDir = workerDirs[0]!;
          const installPath = getInstallPath(targetDir, packageInfo);

          // Validate path is safe
          if (!isPathSafe(targetDir, installPath)) {
            throw new ValidationError("Invalid package name (path traversal)", "PATH_TRAVERSAL");
          }

          // Remove existing version if exists
          if (await directoryExists(installPath)) {
            await removeDirectory(installPath);
          }

          // Move from temp to install path
          await rename(tempDir, installPath);

          // Log the installation
          await logAppInstall(
            actor,
            packageInfo.name,
            packageInfo.version,
            ctx.req.header("x-forwarded-for") ?? ctx.req.header("x-real-ip"),
            ctx.req.header("user-agent"),
          );

          return ctx.json({
            data: {
              app: {
                installedAt: installPath,
                name: packageInfo.name,
                version: packageInfo.version,
              },
            },
            success: true,
          });
        } catch (err) {
          // Clean up temp directory on error
          await removeDirectory(tempDir).catch(() => {});
          throw err;
        }
      },
    )
    .delete(
      "/:scope/:name",
      describeRoute({
        tags: ["Apps"],
        summary: "Delete app",
        description: "Remove an app (all versions)",
        parameters: [
          AuthHeader,
          {
            name: "scope",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "App scope (e.g., @buntime)",
          },
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "App name",
          },
        ],
        responses: {
          200: {
            description: "App deleted successfully",
            content: { "application/json": { schema: SuccessResponse } },
          },
          ...CommonErrors,
        },
      }),
      async (ctx) => {
        const actor = requirePermission(ctx, "apps:remove");
        const { workerDirs } = getConfig();
        const scope = ctx.req.param("scope");
        const name = ctx.req.param("name");

        if (!scope || !name) {
          throw new ValidationError("Scope and name are required", "MISSING_PARAMS");
        }

        const fullName = scope.startsWith("@") ? `${scope}/${name}` : name;
        const { name: pkgName, scope: pkgScope } = parsePackageName(fullName);

        // Find app in workerDirs
        let found = false;
        for (const appDir of workerDirs) {
          const packagePath = pkgScope ? join(appDir, pkgScope, pkgName) : join(appDir, pkgName);

          if (await directoryExists(packagePath)) {
            await removeDirectory(packagePath);
            found = true;
            break;
          }
        }

        if (!found) {
          throw new NotFoundError(`App not found: ${fullName}`, "APP_NOT_FOUND");
        }

        // Log the removal
        await logAppRemove(
          actor,
          fullName,
          ctx.req.header("x-forwarded-for") ?? ctx.req.header("x-real-ip"),
          ctx.req.header("user-agent"),
        );

        return ctx.json({ success: true });
      },
    )
    .delete(
      "/:scope/:name/:version",
      describeRoute({
        tags: ["Apps"],
        summary: "Delete app version",
        description: "Remove a specific version of an app",
        parameters: [
          AuthHeader,
          {
            name: "scope",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "App scope",
          },
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "App name",
          },
          {
            name: "version",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Version to delete",
          },
        ],
        responses: {
          200: {
            description: "Version deleted successfully",
            content: { "application/json": { schema: SuccessResponse } },
          },
          ...CommonErrors,
        },
      }),
      async (ctx) => {
        const actor = requirePermission(ctx, "apps:remove");
        const { workerDirs } = getConfig();
        const scope = ctx.req.param("scope");
        const name = ctx.req.param("name");
        const version = ctx.req.param("version");

        if (!scope || !name || !version) {
          throw new ValidationError("Scope, name and version are required", "MISSING_PARAMS");
        }

        const fullName = scope.startsWith("@") ? `${scope}/${name}` : name;
        const { name: pkgName, scope: pkgScope } = parsePackageName(fullName);

        // Find app version in workerDirs
        let found = false;
        for (const appDir of workerDirs) {
          const versionPath = pkgScope
            ? join(appDir, pkgScope, pkgName, version)
            : join(appDir, pkgName, version);

          if (await directoryExists(versionPath)) {
            await removeDirectory(versionPath);
            found = true;
            break;
          }
        }

        if (!found) {
          throw new NotFoundError(
            `App version not found: ${fullName}@${version}`,
            "VERSION_NOT_FOUND",
          );
        }

        // Log the removal
        await logAppRemove(
          actor,
          `${fullName}@${version}`,
          ctx.req.header("x-forwarded-for") ?? ctx.req.header("x-real-ip"),
          ctx.req.header("user-agent"),
        );

        return ctx.json({ success: true });
      },
    );
}

export type AppsRoutesType = ReturnType<typeof createAppsRoutes>;
