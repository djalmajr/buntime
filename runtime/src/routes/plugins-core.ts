/**
 * Core Plugins API Routes (/api/core/plugins)
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
 */

import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { errorToResponse, NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { getConfig } from "@/config";
import {
  disablePluginById,
  enablePluginById,
  getAllPlugins,
  getPluginById,
  type PluginData,
  removePluginById,
} from "@/libs/database";
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
  for (const p of getAllPlugins()) {
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
function requirePlugin(id: number): PluginData {
  const plugin = getPluginById(id);
  if (!plugin) {
    throw new NotFoundError(`Plugin not found: ${id}`, "PLUGIN_NOT_FOUND");
  }
  return plugin;
}

interface PluginsCoreRoutesDeps {
  loader: PluginLoader;
}

/**
 * Create plugins core routes
 */
export function createPluginsCoreRoutes({ loader }: PluginsCoreRoutesDeps) {
  return (
    new Hono()
      // List all plugins
      .get("/", async (ctx) => {
        const plugins = await listInstalledPlugins();
        return ctx.json(plugins);
      })

      // Reload all plugins (rescan pluginDirs)
      .post("/reload", async (ctx) => {
        await loader.rescan();
        const plugins = loader.list();
        return ctx.json({ ok: true, plugins });
      })

      // Reset all plugins (remove from DB, re-seed from manifest)
      .post("/reset", async (ctx) => {
        // Remove all plugins from database
        for (const plugin of getAllPlugins()) {
          removePluginById(plugin.id);
        }

        // Rescan to re-seed from manifests
        await loader.rescan();

        const plugins = await listInstalledPlugins();
        return ctx.json({ plugins, success: true });
      })

      // Upload a plugin (tarball or zip)
      .post("/upload", async (ctx) => {
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
      })

      // Get a plugin by ID
      .get("/:id", async (ctx) => {
        const id = parseId(ctx.req.param("id"));
        const plugin = requirePlugin(id);
        return ctx.json(plugin);
      })

      // Enable a plugin by ID
      .put("/:id/enable", async (ctx) => {
        const id = parseId(ctx.req.param("id"));
        requirePlugin(id); // Ensure exists

        const plugin = enablePluginById(id);

        // Reload plugins to apply changes
        await loader.rescan();

        return ctx.json({ plugin, success: true });
      })

      // Disable a plugin by ID
      .put("/:id/disable", async (ctx) => {
        const id = parseId(ctx.req.param("id"));
        requirePlugin(id); // Ensure exists

        const plugin = disablePluginById(id);

        // Reload plugins to apply changes
        await loader.rescan();

        return ctx.json({ plugin, success: true });
      })

      // Reload a plugin by ID
      .post("/:id/reload", async (ctx) => {
        const id = parseId(ctx.req.param("id"));
        requirePlugin(id); // Ensure exists

        // Rescan all (individual reload not yet supported in loader)
        await loader.rescan();

        const plugin = getPluginById(id);
        return ctx.json({ plugin, success: true });
      })

      // Reset a plugin by ID (remove from DB, re-seed from manifest)
      .post("/:id/reset", async (ctx) => {
        const id = parseId(ctx.req.param("id"));
        const existing = requirePlugin(id);

        // Remove from database
        removePluginById(id);

        // Rescan to re-seed from manifest
        await loader.rescan();

        // Find the plugin again by name (it will have a new ID)
        const plugins = getAllPlugins();
        const plugin = plugins.find((p) => p.name === existing.name) ?? null;

        return ctx.json({ plugin, success: true });
      })

      // Delete a plugin by ID (remove from filesystem)
      .delete("/:id", async (ctx) => {
        const { pluginDirs } = getConfig();
        const id = parseId(ctx.req.param("id"));
        const plugin = requirePlugin(id);

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
        removePluginById(id);

        return ctx.json({ success: true });
      })

      // List versions for a plugin by ID
      .get("/:id/versions", async (ctx) => {
        const id = parseId(ctx.req.param("id"));
        const plugin = requirePlugin(id);

        const versions = loader.getVersions(plugin.name);
        const active = loader.getActiveVersion(plugin.name);

        return ctx.json({ active, versions });
      })

      // Select active version for a plugin by ID
      .put("/:id/version", async (ctx) => {
        const id = parseId(ctx.req.param("id"));
        const plugin = requirePlugin(id);

        const body = await ctx.req.json<{ version: string }>();
        if (!body.version) {
          throw new ValidationError("Version is required", "MISSING_VERSION");
        }

        loader.setActiveVersion(plugin.name, body.version);

        return ctx.json({ ok: true, activeVersion: body.version });
      })

      .onError((err) => {
        return errorToResponse(err);
      })
  );
}

export type PluginsCoreRoutesType = ReturnType<typeof createPluginsCoreRoutes>;
