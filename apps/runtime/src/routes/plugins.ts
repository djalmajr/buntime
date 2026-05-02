/**
 * Plugins API Routes (/api/plugins)
 *
 * Provides plugin management endpoints for:
 * - Listing installed plugins
 * - Uploading new plugins (tarball or zip)
 * - Removing plugins
 * - Reload plugins (rescan filesystem)
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ForbiddenError, NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "@/config";
import { PluginInfoSchema, SuccessResponse } from "@/libs/openapi";
import {
  createTempDir,
  detectArchiveFormat,
  directoryExists,
  extractArchive,
  getInstallSource,
  getPackageRootPath,
  type InstallSource,
  isPathSafe,
  isRemovableInstallDir,
  moveDirectory,
  parsePackageName,
  readPackageInfo,
  removeDirectory,
  selectInstallDir,
} from "@/libs/registry/packager";
import type { PluginLoader } from "@/plugins/loader";
import type { PluginRegistry } from "@/plugins/registry";
import { readUploadFile } from "@/routes/upload-form";

/**
 * Plugin info for API responses
 */
interface PluginInfo {
  name: string;
  path: string;
  removable: boolean;
  source: InstallSource;
}

/**
 * List all installed plugins from pluginDirs
 */
async function listInstalledPlugins(pluginDirs: string[]): Promise<PluginInfo[]> {
  const plugins: PluginInfo[] = [];

  for (const pluginDir of pluginDirs) {
    if (!(await directoryExists(pluginDir))) continue;

    const entries = await readdir(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      const fullPath = join(pluginDir, name);

      if (name.startsWith("@")) {
        // Scoped package: @scope/name
        const scopeEntries = await readdir(fullPath, { withFileTypes: true });

        for (const scopeEntry of scopeEntries) {
          if (!scopeEntry.isDirectory()) continue;

          plugins.push({
            name: `${name}/${scopeEntry.name}`,
            path: join(fullPath, scopeEntry.name),
            removable: isRemovableInstallDir(pluginDir, pluginDirs),
            source: getInstallSource(pluginDir, pluginDirs),
          });
        }
      } else {
        // Unscoped package
        plugins.push({
          name,
          path: fullPath,
          removable: isRemovableInstallDir(pluginDir, pluginDirs),
          source: getInstallSource(pluginDir, pluginDirs),
        });
      }
    }
  }

  return plugins;
}

interface PluginsRoutesDeps {
  loader: PluginLoader;
  pluginDirs?: string[];
  registry: PluginRegistry;
}

function getPluginDirs(deps: PluginsRoutesDeps): string[] {
  return deps.pluginDirs ?? getConfig().pluginDirs;
}

/**
 * Create plugins routes
 */
export function createPluginsRoutes(deps: PluginsRoutesDeps) {
  const { loader, registry } = deps;

  return (
    new Hono()
      // List loaded plugins (from registry - runtime state)
      .get(
        "/loaded",
        describeRoute({
          description:
            "Returns information about all loaded plugins including their menus and dependencies",
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
                        removable: { type: "boolean" },
                        source: { enum: ["built-in", "uploaded"], type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        async (ctx) => {
          const plugins = await listInstalledPlugins(getPluginDirs(deps));
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
          const pluginDirs = getPluginDirs(deps);

          if (pluginDirs.length === 0) {
            throw new ValidationError("No pluginDirs configured", "NO_PLUGIN_DIRS");
          }

          const file = await readUploadFile(ctx);

          const format = detectArchiveFormat(file.name);
          if (!format) {
            throw new ValidationError("File must be .tgz, .tar.gz, or .zip", "INVALID_FILE_TYPE");
          }

          const tempDir = await createTempDir();

          try {
            await extractArchive(file, tempDir, format);

            const packageInfo = await readPackageInfo(tempDir);
            // Use the external/writable pluginDir and install directly at the
            // package root because the plugin loader does not scan version dirs.
            const targetDir = selectInstallDir(pluginDirs);
            if (!targetDir) {
              throw new ValidationError("No pluginDirs configured", "NO_PLUGIN_DIRS");
            }
            const installPath = getPackageRootPath(targetDir, packageInfo);

            if (!isPathSafe(targetDir, installPath)) {
              throw new ValidationError("Invalid package name (path traversal)", "PATH_TRAVERSAL");
            }

            if (await directoryExists(installPath)) {
              await removeDirectory(installPath);
            }

            await moveDirectory(tempDir, installPath);

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
          const pluginDirs = getPluginDirs(deps);
          const name = decodeURIComponent(ctx.req.param("name"));

          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }

          const { name: pkgName, scope: pkgScope } = parsePackageName(name);

          let builtInFound = false;
          let found = false;

          for (const pluginDir of pluginDirs) {
            const packagePath = pkgScope
              ? join(pluginDir, pkgScope, pkgName)
              : join(pluginDir, pkgName);

            if (await directoryExists(packagePath)) {
              if (!isRemovableInstallDir(pluginDir, pluginDirs)) {
                builtInFound = true;
                continue;
              }

              await removeDirectory(packagePath);
              found = true;
              break;
            }
          }

          if (!found) {
            if (builtInFound) {
              throw new ForbiddenError(
                `Built-in plugin cannot be removed: ${name}`,
                "BUILT_IN_PLUGIN_REMOVE_FORBIDDEN",
              );
            }

            throw new NotFoundError(`Plugin files not found: ${name}`, "PLUGIN_NOT_FOUND");
          }

          return ctx.json({ success: true });
        },
      )
  );
}

export type PluginsRoutesType = ReturnType<typeof createPluginsRoutes>;
