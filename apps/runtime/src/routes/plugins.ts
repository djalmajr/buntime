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

interface InstalledPluginPackage extends PluginInfo {
  directoryName: string;
}

async function readInstalledPlugin(
  pluginDir: string,
  pluginDirs: string[],
  packagePath: string,
  directoryName: string,
): Promise<InstalledPluginPackage | null> {
  try {
    const packageInfo = await readPackageInfo(packagePath);

    return {
      directoryName,
      name: packageInfo.name,
      path: packagePath,
      removable: isRemovableInstallDir(pluginDir, pluginDirs),
      source: getInstallSource(pluginDir, pluginDirs),
    };
  } catch {
    return null;
  }
}

/**
 * List all installed plugins from pluginDirs
 */
async function discoverInstalledPlugins(pluginDirs: string[]): Promise<InstalledPluginPackage[]> {
  const plugins: InstalledPluginPackage[] = [];

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

          const directoryName = `${name}/${scopeEntry.name}`;
          const plugin = await readInstalledPlugin(
            pluginDir,
            pluginDirs,
            join(fullPath, scopeEntry.name),
            directoryName,
          );

          if (plugin) plugins.push(plugin);
        }
      } else {
        // Unscoped package
        const plugin = await readInstalledPlugin(pluginDir, pluginDirs, fullPath, name);

        if (plugin) plugins.push(plugin);
      }
    }
  }

  return plugins;
}

async function listInstalledPlugins(pluginDirs: string[]): Promise<PluginInfo[]> {
  return (await discoverInstalledPlugins(pluginDirs)).map((plugin) => ({
    name: plugin.name,
    path: plugin.path,
    removable: plugin.removable,
    source: plugin.source,
  }));
}

/**
 * Set the `enabled` flag in a plugin's manifest, preserving comments and
 * formatting. Surgically replaces an existing top-level `enabled:` line, or
 * prepends one when absent. Returns false if no manifest file exists.
 *
 * The manifest is the source of truth for enabled state (the loader skips
 * `enabled: false`), so toggling here + a rescan is enough to load/unload a
 * plugin at runtime.
 */
async function setManifestEnabled(pluginDir: string, enabled: boolean): Promise<boolean> {
  for (const filename of ["manifest.yaml", "manifest.yml"]) {
    const manifestPath = join(pluginDir, filename);
    const file = Bun.file(manifestPath);
    if (!(await file.exists())) continue;

    const content = await file.text();
    const line = `enabled: ${enabled}`;
    // Match a top-level `enabled:` line (no leading whitespace).
    const enabledRe = /^enabled:[^\n]*$/m;
    const next = enabledRe.test(content) ? content.replace(enabledRe, line) : `${line}\n${content}`;

    await Bun.write(manifestPath, next);
    return true;
  }
  return false;
}

/**
 * Find an installed plugin directory by its manifest `name` or directory name.
 */
async function findPluginDir(pluginDirs: string[], name: string): Promise<string | null> {
  for (const plugin of await discoverInstalledPlugins(pluginDirs)) {
    if (plugin.name === name || plugin.directoryName === name) {
      return plugin.path;
    }
  }
  return null;
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
          // Refresh the live server's native routes so newly discovered
          // plugins' server.routes go live without a process restart.
          registry.reloadServerRoutes();
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

          let builtInFound = false;
          let found = false;

          for (const plugin of await discoverInstalledPlugins(pluginDirs)) {
            if (plugin.name !== name && plugin.directoryName !== name) continue;

            if (!plugin.removable) {
              builtInFound = true;
              continue;
            }

            await removeDirectory(plugin.path);
            found = true;
            break;
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

      // Enable or disable a plugin at runtime (no restart).
      // Toggles manifest.enabled, rescans, and refreshes live server routes.
      .post(
        "/:name/:action{enable|disable}",
        describeRoute({
          tags: ["Plugins"],
          summary: "Enable or disable a plugin",
          description:
            "Flips the plugin's manifest `enabled` flag and hot-reloads the registry " +
            "without a process restart. `:name` is URL-encoded (scoped names supported).",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Plugin name (URL encoded, e.g. %40scope%2Fname)",
            },
            {
              name: "action",
              in: "path",
              required: true,
              schema: { enum: ["enable", "disable"], type: "string" },
              description: "enable or disable",
            },
          ],
          responses: {
            200: {
              description: "Plugin toggled and registry hot-reloaded",
              content: { "application/json": { schema: SuccessResponse } },
            },
          },
        }),
        async (ctx) => {
          const pluginDirs = getPluginDirs(deps);
          const name = decodeURIComponent(ctx.req.param("name"));
          const enabled = ctx.req.param("action") === "enable";

          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }

          const dir = await findPluginDir(pluginDirs, name);
          if (!dir) {
            throw new NotFoundError(`Plugin not found: ${name}`, "PLUGIN_NOT_FOUND");
          }

          const updated = await setManifestEnabled(dir, enabled);
          if (!updated) {
            throw new NotFoundError(
              `Plugin manifest not found for: ${name}`,
              "PLUGIN_MANIFEST_NOT_FOUND",
            );
          }

          // Hot-reload: rescan picks up the new enabled state; reloadServerRoutes
          // refreshes Bun's native route table so the change takes effect now.
          await loader.rescan();
          registry.reloadServerRoutes();

          return ctx.json({ data: { enabled, name }, success: true });
        },
      )
  );
}

export type PluginsRoutesType = ReturnType<typeof createPluginsRoutes>;
