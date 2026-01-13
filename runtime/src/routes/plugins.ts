/**
 * Plugins API Routes (/api/plugins)
 *
 * Provides plugin management endpoints for:
 * - Listing installed plugins
 * - Uploading new plugins (tarball or zip)
 * - Removing plugins
 * - Managing plugin versions (reload, select, list versions)
 * - Enable/disable plugins
 * - Reload plugins (rescan filesystem)
 * - Reset plugins (re-seed from manifest)
 *
 * This API is always available in the runtime (solves bootstrap problem).
 * Plugins are identified by database ID for all operations.
 *
 * Authorization:
 * - plugins:read permission: Can list plugins and versions
 * - plugins:install permission: Can upload new plugins
 * - plugins:remove permission: Can delete plugins
 * - plugins:enable permission: Can enable plugins
 * - plugins:disable permission: Can disable plugins
 * - plugins:config permission: Can reload, reset, and change versions
 */

import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { ForbiddenError, NotFoundError, ValidationError } from "@buntime/shared/errors";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "@/config";
import { hasPermission, type Permission, type ValidatedKey } from "@/libs/api-keys";
import { logPluginDisable, logPluginEnable, logPluginInstall, logPluginRemove } from "@/libs/audit";
import {
  disablePluginById,
  enablePluginById,
  getAllPlugins,
  getPluginById,
  type PluginData,
  removePluginById,
} from "@/libs/database";
import type { AppEnv } from "@/libs/hono-context";
import {
  AuthHeader,
  CommonErrors,
  IdParam,
  PluginDataSchema,
  PluginInfoSchema,
  SuccessResponse,
} from "@/libs/openapi";
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
 * Combines filesystem info with database state
 */
interface PluginInfo extends Partial<PluginData> {
  name: string;
  path: string;
  versions: string[];
}

/**
 * List all installed plugins from pluginDirs
 * Merges filesystem info (path, versions) with database state (enabled, config, etc.)
 */
async function listInstalledPlugins(): Promise<PluginInfo[]> {
  const { pluginDirs } = getConfig();
  const plugins: PluginInfo[] = [];

  // Get all plugin data from database (indexed by name)
  const dbPlugins = new Map<string, PluginData>();
  for (const p of await getAllPlugins()) {
    dbPlugins.set(p.name, p);
  }

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
            const pluginName = `${name}/${scopeEntry.name}`;
            const dbData = dbPlugins.get(pluginName);

            plugins.push({
              ...dbData,
              name: pluginName,
              path: packagePath,
              versions,
            });
          }
        }
      } else {
        // Unscoped package: name/version
        const versions = await getVersions(fullPath);

        if (versions.length > 0) {
          const dbData = dbPlugins.get(name);

          plugins.push({
            ...dbData,
            name,
            path: fullPath,
            versions,
          });
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

/**
 * Get validated key from Hono context
 */
function getValidatedKey(ctx: Context): ValidatedKey | null {
  return (ctx as Context<AppEnv>).get("validatedKey");
}

/**
 * Require a validated key with specific permission
 */
function requirePermission(ctx: Context, permission: Permission): ValidatedKey {
  const key = getValidatedKey(ctx);

  if (!key) {
    throw new ForbiddenError("Authentication required", "AUTH_REQUIRED");
  }

  if (!hasPermission(key, permission)) {
    throw new ForbiddenError(`Permission denied: ${permission}`, "PERMISSION_DENIED");
  }

  return key;
}

/**
 * Parse and validate id parameter
 */
function parseId(idParam: string | undefined): number {
  if (!idParam) {
    throw new ValidationError("Plugin ID is required", "MISSING_ID");
  }
  const id = parseInt(idParam, 10);
  if (Number.isNaN(id) || id < 1) {
    throw new ValidationError("Invalid plugin ID", "INVALID_ID");
  }
  return id;
}

/**
 * Get plugin by ID or throw NotFoundError
 */
async function requirePlugin(id: number): Promise<PluginData> {
  const plugin = await getPluginById(id);
  if (!plugin) {
    throw new NotFoundError(`Plugin not found: ${id}`, "PLUGIN_NOT_FOUND");
  }
  return plugin;
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

      // List all installed plugins (from filesystem + database)
      .get(
        "/",
        describeRoute({
          tags: ["Plugins"],
          summary: "List installed plugins",
          description: "Returns all plugins installed in pluginDirs",
          parameters: [AuthHeader],
          responses: {
            200: {
              description: "List of plugins",
              content: {
                "application/json": { schema: { type: "array", items: PluginDataSchema } },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:read");
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
          parameters: [AuthHeader],
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
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:config");
          await loader.rescan();
          const plugins = loader.list();
          return ctx.json({ ok: true, plugins });
        },
      )

      // Reset all plugins (remove from DB, re-seed from manifest)
      .post(
        "/reset",
        describeRoute({
          tags: ["Plugins"],
          summary: "Reset all plugins",
          description: "Removes all plugins from DB and re-seeds from manifests",
          parameters: [AuthHeader],
          responses: {
            200: {
              description: "Plugins reset",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      plugins: { type: "array", items: PluginDataSchema },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:config");

          // Remove all plugins from database
          for (const plugin of await getAllPlugins()) {
            await removePluginById(plugin.id);
          }

          // Rescan to re-seed from manifests
          await loader.rescan();

          const plugins = await listInstalledPlugins();
          return ctx.json({ plugins, success: true });
        },
      )

      // Upload a plugin (tarball or zip)
      .post(
        "/upload",
        describeRoute({
          tags: ["Plugins"],
          summary: "Upload plugin",
          description: "Upload a new plugin (tarball or zip)",
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
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "plugins:install");
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

            // Log the installation
            await logPluginInstall(
              actor,
              packageInfo.name,
              packageInfo.version,
              ctx.req.header("x-forwarded-for") ?? ctx.req.header("x-real-ip"),
              ctx.req.header("user-agent"),
            );

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

      // Get a plugin by ID
      .get(
        "/:id",
        describeRoute({
          tags: ["Plugins"],
          summary: "Get plugin",
          description: "Returns a plugin by ID",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Plugin details",
              content: { "application/json": { schema: PluginDataSchema } },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:read");
          const id = parseId(ctx.req.param("id"));
          const plugin = await requirePlugin(id);
          return ctx.json(plugin);
        },
      )

      // Enable a plugin by ID
      .put(
        "/:id/enable",
        describeRoute({
          tags: ["Plugins"],
          summary: "Enable plugin",
          description: "Enables a plugin by ID",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Plugin enabled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { success: { type: "boolean" }, plugin: PluginDataSchema },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "plugins:enable");
          const id = parseId(ctx.req.param("id"));
          const existing = await requirePlugin(id);

          const plugin = await enablePluginById(id);

          // Log the action
          await logPluginEnable(
            actor,
            id,
            existing.name,
            ctx.req.header("x-forwarded-for") ?? ctx.req.header("x-real-ip"),
            ctx.req.header("user-agent"),
          );

          // Reload plugins to apply changes
          await loader.rescan();

          return ctx.json({ plugin, success: true });
        },
      )

      // Disable a plugin by ID
      .put(
        "/:id/disable",
        describeRoute({
          tags: ["Plugins"],
          summary: "Disable plugin",
          description: "Disables a plugin by ID",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Plugin disabled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { success: { type: "boolean" }, plugin: PluginDataSchema },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "plugins:disable");
          const id = parseId(ctx.req.param("id"));
          const existing = await requirePlugin(id);

          const plugin = await disablePluginById(id);

          // Log the action
          await logPluginDisable(
            actor,
            id,
            existing.name,
            ctx.req.header("x-forwarded-for") ?? ctx.req.header("x-real-ip"),
            ctx.req.header("user-agent"),
          );

          // Reload plugins to apply changes
          await loader.rescan();

          return ctx.json({ plugin, success: true });
        },
      )

      // Reload a plugin by ID
      .post(
        "/:id/reload",
        describeRoute({
          tags: ["Plugins"],
          summary: "Reload plugin",
          description: "Reloads a specific plugin",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Plugin reloaded",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { success: { type: "boolean" }, plugin: PluginDataSchema },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:config");
          const id = parseId(ctx.req.param("id"));
          await requirePlugin(id); // Ensure exists

          // Rescan all (individual reload not yet supported in loader)
          await loader.rescan();

          const plugin = await getPluginById(id);
          return ctx.json({ plugin, success: true });
        },
      )

      // Reset a plugin by ID (remove from DB, re-seed from manifest)
      .post(
        "/:id/reset",
        describeRoute({
          tags: ["Plugins"],
          summary: "Reset plugin",
          description: "Removes plugin from DB and re-seeds from manifest (gets new ID)",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Plugin reset",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { success: { type: "boolean" }, plugin: PluginDataSchema },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:config");
          const id = parseId(ctx.req.param("id"));
          const existing = await requirePlugin(id);

          // Remove from database
          await removePluginById(id);

          // Rescan to re-seed from manifest
          await loader.rescan();

          // Find the plugin again by name (it will have a new ID)
          const plugins = await getAllPlugins();
          const plugin = plugins.find((p) => p.name === existing.name) ?? null;

          return ctx.json({ plugin, success: true });
        },
      )

      // Delete a plugin by ID (remove from filesystem)
      .delete(
        "/:id",
        describeRoute({
          tags: ["Plugins"],
          summary: "Delete plugin",
          description: "Removes plugin from filesystem and database",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Plugin deleted",
              content: { "application/json": { schema: SuccessResponse } },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "plugins:remove");
          const { pluginDirs } = getConfig();
          const id = parseId(ctx.req.param("id"));
          const plugin = await requirePlugin(id);

          const { name: pkgName, scope: pkgScope } = parsePackageName(plugin.name);

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
            throw new NotFoundError(`Plugin files not found: ${plugin.name}`, "PLUGIN_NOT_FOUND");
          }

          // Also remove from database
          await removePluginById(id);

          // Log the removal
          await logPluginRemove(
            actor,
            id,
            plugin.name,
            ctx.req.header("x-forwarded-for") ?? ctx.req.header("x-real-ip"),
            ctx.req.header("user-agent"),
          );

          return ctx.json({ success: true });
        },
      )

      // List versions for a plugin by ID
      .get(
        "/:id/versions",
        describeRoute({
          tags: ["Plugins"],
          summary: "List plugin versions",
          description: "Returns available versions for a plugin",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Plugin versions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      versions: { type: "array", items: { type: "string" } },
                      active: { type: "string" },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:read");
          const id = parseId(ctx.req.param("id"));
          const plugin = await requirePlugin(id);

          const versions = loader.getVersions(plugin.name);
          const active = await loader.getActiveVersion(plugin.name);

          return ctx.json({ active, versions });
        },
      )

      // Select active version for a plugin by ID
      .put(
        "/:id/version",
        describeRoute({
          tags: ["Plugins"],
          summary: "Set active version",
          description: "Sets the active version for a plugin",
          parameters: [AuthHeader, IdParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { version: { type: "string" } },
                  required: ["version"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Version set",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { ok: { type: "boolean" }, activeVersion: { type: "string" } },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "plugins:config");
          const id = parseId(ctx.req.param("id"));
          const plugin = await requirePlugin(id);

          const body = await ctx.req.json<{ version: string }>();
          if (!body.version) {
            throw new ValidationError("Version is required", "MISSING_VERSION");
          }

          await loader.setActiveVersion(plugin.name, body.version);

          return ctx.json({ ok: true, activeVersion: body.version });
        },
      )
  );
}

export type PluginsRoutesType = ReturnType<typeof createPluginsRoutes>;
