/**
 * Plugins API Routes (/api/plugins)
 *
 * Provides plugin management endpoints for:
 * - Listing installed plugins
 * - Uploading new plugins (tarball or zip)
 * - Removing plugins
 * - Reload plugins (rescan filesystem)
 */

import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "@/config";
import { PluginInfoSchema, SuccessResponse } from "@/libs/openapi";
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
import type { PluginLoader } from "@/plugins/loader";
import type { PluginRegistry } from "@/plugins/registry";

/**
 * Plugin info for API responses
 */
interface PluginInfo {
  name: string;
  path: string;
  versions: string[];
}

/**
 * List all installed plugins from pluginDirs
 */
async function listInstalledPlugins(): Promise<PluginInfo[]> {
  const { pluginDirs } = getConfig();
  const plugins: PluginInfo[] = [];

  for (const pluginDir of pluginDirs) {
    if (!(await directoryExists(pluginDir))) continue;

    const entries = await readdir(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      const fullPath = join(pluginDir, name);

      if (name.startsWith("@")) {
        // Scoped package: @scope/name/version
        const scopeDir = fullPath;
        const scopeEntries = await readdir(scopeDir, { withFileTypes: true });

        for (const scopeEntry of scopeEntries) {
          if (!scopeEntry.isDirectory()) continue;

          const packagePath = join(scopeDir, scopeEntry.name);
          const versions = await getVersions(packagePath);

          if (versions.length > 0) {
            plugins.push({
              name: `${name}/${scopeEntry.name}`,
              path: packagePath,
              versions,
            });
          }
        }
      } else {
        // Unscoped package: name/version or flat structure
        const versions = await getVersions(fullPath);

        if (versions.length > 0) {
          plugins.push({
            name,
            path: fullPath,
            versions,
          });
        } else {
          // Check if it's a flat plugin structure (has manifest.jsonc directly)
          const hasManifest = await Bun.file(join(fullPath, "manifest.jsonc")).exists();
          if (hasManifest) {
            plugins.push({
              name,
              path: fullPath,
              versions: ["latest"],
            });
          }
        }
      }
    }
  }

  return plugins;
}

/**
 * Get version directories from a package path
 */
async function getVersions(packagePath: string): Promise<string[]> {
  try {
    const entries = await readdir(packagePath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // Latest first
  } catch {
    return [];
  }
}

interface PluginsRoutesDeps {
  loader: PluginLoader;
  registry: PluginRegistry;
}

/**
 * Create plugins routes
 */
export function createPluginsRoutes({ loader, registry }: PluginsRoutesDeps) {
  return (
    new Hono()
      // List loaded plugins (from registry - runtime state)
      .get(
        "/loaded",
        describeRoute({
          description:
            "Returns information about all loaded plugins including their menus, fragments, and dependencies",
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { items: PluginInfoSchema, type: "array" },
                },
              },
              description: "List of loaded plugins",
            },
          },
          summary: "List loaded plugins",
          tags: ["Plugins"],
        }),
        (ctx) => {
          const plugins = registry.getAll().map((plugin) => ({
            base: plugin.base,
            dependencies: plugin.dependencies ?? [],
            fragment: plugin.fragment
              ? {
                  enabled: true,
                  origin: plugin.fragment.origin,
                  preloadStyles: plugin.fragment.preloadStyles,
                  type: plugin.fragment.type,
                }
              : { enabled: false },
            menus: plugin.menus ?? [],
            name: plugin.name,
            optionalDependencies: plugin.optionalDependencies ?? [],
          }));
          return ctx.json(plugins);
        },
      )

      // List all installed plugins (from filesystem)
      .get(
        "/",
        describeRoute({
          tags: ["Plugins"],
          summary: "List installed plugins",
          description: "Returns all plugins installed in pluginDirs",
          responses: {
            200: {
              description: "List of plugins",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        path: { type: "string" },
                        versions: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        async (ctx) => {
          const plugins = await listInstalledPlugins();
          return ctx.json(plugins);
        },
      )

      // Reload all plugins (rescan pluginDirs)
      .post(
        "/reload",
        describeRoute({
          tags: ["Plugins"],
          summary: "Reload all plugins",
          description: "Re-scans pluginDirs and reloads all plugins",
          responses: {
            200: {
              description: "Plugins reloaded",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      plugins: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
          },
        }),
        async (ctx) => {
          await loader.rescan();
          const plugins = loader.list();
          return ctx.json({ ok: true, plugins });
        },
      )

      // Upload a plugin (tarball or zip)
      .post(
        "/upload",
        describeRoute({
          tags: ["Plugins"],
          summary: "Upload plugin",
          description: "Upload a new plugin (tarball or zip)",
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
                      description: "Plugin archive (.tgz, .tar.gz, or .zip)",
                    },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Plugin uploaded",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "object",
                        properties: {
                          plugin: {
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
          },
        }),
        async (ctx) => {
          const { pluginDirs } = getConfig();

          if (pluginDirs.length === 0) {
            throw new ValidationError("No pluginDirs configured", "NO_PLUGIN_DIRS");
          }

          const formData = await ctx.req.formData();
          const file = formData.get("file") as File | null;

          if (!file) {
            throw new ValidationError("No file provided", "NO_FILE_PROVIDED");
          }

          const format = detectArchiveFormat(file.name);
          if (!format) {
            throw new ValidationError("File must be .tgz, .tar.gz, or .zip", "INVALID_FILE_TYPE");
          }

          const tempDir = await createTempDir();

          try {
            await extractArchive(file, tempDir, format);

            const packageInfo = await readPackageInfo(tempDir);
            const targetDir = pluginDirs[0]!;
            const installPath = getInstallPath(targetDir, packageInfo);

            if (!isPathSafe(targetDir, installPath)) {
              throw new ValidationError("Invalid package name (path traversal)", "PATH_TRAVERSAL");
            }

            if (await directoryExists(installPath)) {
              await removeDirectory(installPath);
            }

            await rename(tempDir, installPath);

            return ctx.json({
              data: {
                plugin: {
                  installedAt: installPath,
                  name: packageInfo.name,
                  version: packageInfo.version,
                },
              },
              success: true,
            });
          } catch (err) {
            await removeDirectory(tempDir).catch(() => {});
            throw err;
          }
        },
      )

      // Delete a plugin by name
      .delete(
        "/:name",
        describeRoute({
          tags: ["Plugins"],
          summary: "Delete plugin",
          description: "Removes plugin from filesystem",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Plugin name (URL encoded)",
            },
          ],
          responses: {
            200: {
              description: "Plugin deleted",
              content: { "application/json": { schema: SuccessResponse } },
            },
          },
        }),
        async (ctx) => {
          const { pluginDirs } = getConfig();
          const name = decodeURIComponent(ctx.req.param("name"));

          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }

          const { name: pkgName, scope: pkgScope } = parsePackageName(name);

          // Find and remove plugin from pluginDirs
          let found = false;
          for (const pluginDir of pluginDirs) {
            const packagePath = pkgScope
              ? join(pluginDir, pkgScope, pkgName)
              : join(pluginDir, pkgName);

            if (await directoryExists(packagePath)) {
              await removeDirectory(packagePath);
              found = true;
              break;
            }
          }

          if (!found) {
            throw new NotFoundError(`Plugin files not found: ${name}`, "PLUGIN_NOT_FOUND");
          }

          return ctx.json({ success: true });
        },
      )
  );
}

export type PluginsRoutesType = ReturnType<typeof createPluginsRoutes>;
