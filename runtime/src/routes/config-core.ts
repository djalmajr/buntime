/**
 * Core Config API Routes (/api/core/config)
 *
 * Provides configuration management endpoints for:
 * - Plugin version selection (active version per plugin)
 * - Plugin configuration overrides (key-value settings)
 *
 * This API is always available in the runtime (solves bootstrap problem).
 * Configuration is stored in buntime.db (SQLite) in a single `plugins` table.
 */

import { errorToResponse, NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import {
  deletePluginConfig,
  getAllPlugins,
  getPluginConfig,
  getPluginVersion,
  setPluginConfig,
  setPluginVersion,
} from "@/libs/database";
import type { PluginLoader } from "@/plugins/loader";

interface ConfigCoreRoutesDeps {
  loader: PluginLoader;
}

/**
 * Create config core routes
 */
export function createConfigCoreRoutes({ loader }: ConfigCoreRoutesDeps) {
  return (
    new Hono()
      // GET /api/core/config/plugins - List all plugins with versions and configs
      .get("/plugins", (ctx) => {
        const plugins = getAllPlugins();

        // Transform to expected format for backwards compatibility
        const versions = plugins.map((p) => ({
          name: p.name,
          updatedAt: p.updatedAt,
          version: p.version,
        }));

        // Group configs by plugin
        const configs: Record<string, Record<string, unknown>> = {};
        for (const plugin of plugins) {
          if (Object.keys(plugin.config).length > 0) {
            configs[plugin.name] = plugin.config;
          }
        }

        return ctx.json({ configs, versions });
      })

      // GET /api/core/config/plugins/:name/version - Get active version for a plugin
      .get("/plugins/:name/version", (ctx) => {
        const name = decodeURIComponent(ctx.req.param("name"));
        if (!name) {
          throw new ValidationError("Plugin name is required", "MISSING_NAME");
        }

        const version = getPluginVersion(name);
        const availableVersions = loader.getVersions(name);

        return ctx.json({
          activeVersion: version,
          availableVersions,
          name,
        });
      })

      // PUT /api/core/config/plugins/:name/version - Set active version for a plugin
      .put("/plugins/:name/version", async (ctx) => {
        const name = decodeURIComponent(ctx.req.param("name"));
        if (!name) {
          throw new ValidationError("Plugin name is required", "MISSING_NAME");
        }

        const body = await ctx.req.json<{ version: string }>();
        if (!body.version) {
          throw new ValidationError("Version is required", "MISSING_VERSION");
        }

        // Validate version exists
        const availableVersions = loader.getVersions(name);
        if (availableVersions.length === 0) {
          throw new NotFoundError(`Plugin not found: ${name}`, "PLUGIN_NOT_FOUND");
        }

        if (body.version !== "latest" && !availableVersions.includes(body.version)) {
          throw new ValidationError(
            `Version ${body.version} not found for plugin ${name}`,
            "VERSION_NOT_FOUND",
          );
        }

        setPluginVersion(name, body.version);
        loader.setActiveVersion(name, body.version);

        return ctx.json({ activeVersion: body.version, name, success: true });
      })

      // DELETE /api/core/config/plugins/:name/version - Reset to latest version
      .delete("/plugins/:name/version", (ctx) => {
        const name = decodeURIComponent(ctx.req.param("name"));
        if (!name) {
          throw new ValidationError("Plugin name is required", "MISSING_NAME");
        }

        // Reset to "latest" (default behavior)
        setPluginVersion(name, "latest");
        loader.setActiveVersion(name, "latest");

        return ctx.json({ activeVersion: "latest", name, success: true });
      })

      // GET /api/core/config/plugins/:name/config - Get all config for a plugin
      .get("/plugins/:name/config", (ctx) => {
        const name = decodeURIComponent(ctx.req.param("name"));
        if (!name) {
          throw new ValidationError("Plugin name is required", "MISSING_NAME");
        }

        const config = getPluginConfig(name);
        return ctx.json({ config, plugin: name });
      })

      // PUT /api/core/config/plugins/:name/config/:key - Set a config value
      .put("/plugins/:name/config/:key", async (ctx) => {
        const name = decodeURIComponent(ctx.req.param("name"));
        const key = decodeURIComponent(ctx.req.param("key"));

        if (!name) {
          throw new ValidationError("Plugin name is required", "MISSING_NAME");
        }
        if (!key) {
          throw new ValidationError("Config key is required", "MISSING_KEY");
        }

        const body = await ctx.req.json<{ value: unknown }>();
        if (body.value === undefined) {
          throw new ValidationError("Value is required", "MISSING_VALUE");
        }

        // Store the value directly (setPluginConfig handles JSON serialization)
        setPluginConfig(name, key, body.value);

        return ctx.json({ key, plugin: name, success: true, value: body.value });
      })

      // DELETE /api/core/config/plugins/:name/config/:key - Delete a config key
      .delete("/plugins/:name/config/:key", (ctx) => {
        const name = decodeURIComponent(ctx.req.param("name"));
        const key = decodeURIComponent(ctx.req.param("key"));

        if (!name) {
          throw new ValidationError("Plugin name is required", "MISSING_NAME");
        }
        if (!key) {
          throw new ValidationError("Config key is required", "MISSING_KEY");
        }

        deletePluginConfig(name, key);
        return ctx.json({ key, plugin: name, success: true });
      })

      // DELETE /api/core/config/plugins/:name/config - Delete all config for a plugin
      .delete("/plugins/:name/config", (ctx) => {
        const name = decodeURIComponent(ctx.req.param("name"));
        if (!name) {
          throw new ValidationError("Plugin name is required", "MISSING_NAME");
        }

        deletePluginConfig(name);
        return ctx.json({ plugin: name, success: true });
      })

      .onError((err) => {
        return errorToResponse(err);
      })
  );
}

export type ConfigCoreRoutesType = ReturnType<typeof createConfigCoreRoutes>;
