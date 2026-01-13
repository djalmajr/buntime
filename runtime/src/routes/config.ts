/**
 * Config API Routes (/api/config)
 *
 * Provides configuration management endpoints for:
 * - Plugin version selection (active version per plugin)
 * - Plugin configuration overrides (key-value settings)
 *
 * This API is always available in the runtime (solves bootstrap problem).
 * Configuration is stored in buntime.db (SQLite) in a single `plugins` table.
 *
 * Authorization:
 * - config:read permission: Can read plugin versions and configs
 * - config:write permission: Can modify plugin versions and configs
 */

import { ForbiddenError, NotFoundError, ValidationError } from "@buntime/shared/errors";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { hasPermission, type Permission, type ValidatedKey } from "@/libs/api-keys";
import {
  deletePluginConfig,
  getAllPlugins,
  getPluginConfig,
  getPluginVersion,
  setPluginConfig,
  setPluginVersion,
} from "@/libs/database";
import type { AppEnv } from "@/libs/hono-context";
import { AuthHeader, CommonErrors, PluginNameParam } from "@/libs/openapi";
import type { PluginLoader } from "@/plugins/loader";

interface ConfigRoutesDeps {
  loader: PluginLoader;
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
 * Create config core routes
 */
export function createConfigRoutes({ loader }: ConfigRoutesDeps) {
  return (
    new Hono()
      // GET /api/config/plugins - List all plugins with versions and configs
      .get(
        "/plugins",
        describeRoute({
          tags: ["Config"],
          summary: "List plugin configurations",
          description: "Returns all plugins with their active versions and configurations",
          parameters: [AuthHeader],
          responses: {
            200: {
              description: "Plugin configurations",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      versions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            version: { type: "string" },
                            updatedAt: { type: "integer" },
                          },
                        },
                      },
                      configs: { type: "object", additionalProperties: { type: "object" } },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:read");
          const plugins = await getAllPlugins();

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
        },
      )

      // GET /api/config/plugins/:name/version - Get active version for a plugin
      .get(
        "/plugins/:name/version",
        describeRoute({
          tags: ["Config"],
          summary: "Get active version",
          description: "Returns the active version and available versions for a plugin",
          parameters: [AuthHeader, PluginNameParam],
          responses: {
            200: {
              description: "Plugin version info",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      activeVersion: { type: "string" },
                      availableVersions: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:read");
          const name = decodeURIComponent(ctx.req.param("name"));
          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }

          const version = await getPluginVersion(name);
          const availableVersions = loader.getVersions(name);

          return ctx.json({
            activeVersion: version,
            availableVersions,
            name,
          });
        },
      )

      // PUT /api/config/plugins/:name/version - Set active version for a plugin
      .put(
        "/plugins/:name/version",
        describeRoute({
          tags: ["Config"],
          summary: "Set active version",
          description: "Sets the active version for a plugin",
          parameters: [AuthHeader, PluginNameParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { version: { type: "string", example: "1.0.0" } },
                  required: ["version"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Version set successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      name: { type: "string" },
                      activeVersion: { type: "string" },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:write");
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

          await setPluginVersion(name, body.version);
          await loader.setActiveVersion(name, body.version);

          return ctx.json({ activeVersion: body.version, name, success: true });
        },
      )

      // DELETE /api/config/plugins/:name/version - Reset to latest version
      .delete(
        "/plugins/:name/version",
        describeRoute({
          tags: ["Config"],
          summary: "Reset version to latest",
          description: "Resets the active version to 'latest'",
          parameters: [AuthHeader, PluginNameParam],
          responses: {
            200: {
              description: "Version reset successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      name: { type: "string" },
                      activeVersion: { type: "string" },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:write");
          const name = decodeURIComponent(ctx.req.param("name"));
          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }

          // Reset to "latest" (default behavior)
          await setPluginVersion(name, "latest");
          await loader.setActiveVersion(name, "latest");

          return ctx.json({ activeVersion: "latest", name, success: true });
        },
      )

      // GET /api/config/plugins/:name/config - Get all config for a plugin
      .get(
        "/plugins/:name/config",
        describeRoute({
          tags: ["Config"],
          summary: "Get plugin config",
          description: "Returns all configuration values for a plugin",
          parameters: [AuthHeader, PluginNameParam],
          responses: {
            200: {
              description: "Plugin config",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { plugin: { type: "string" }, config: { type: "object" } },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:read");
          const name = decodeURIComponent(ctx.req.param("name"));
          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }

          const config = await getPluginConfig(name);
          return ctx.json({ config, plugin: name });
        },
      )

      // PUT /api/config/plugins/:name/config/:key - Set a config value
      .put(
        "/plugins/:name/config/:key",
        describeRoute({
          tags: ["Config"],
          summary: "Set config value",
          description: "Sets a configuration value for a plugin",
          parameters: [
            AuthHeader,
            PluginNameParam,
            {
              name: "key",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Config key",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", properties: { value: {} }, required: ["value"] },
              },
            },
          },
          responses: {
            200: {
              description: "Config set successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      plugin: { type: "string" },
                      key: { type: "string" },
                      value: {},
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:write");
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
          await setPluginConfig(name, key, body.value);

          return ctx.json({ key, plugin: name, success: true, value: body.value });
        },
      )

      // DELETE /api/config/plugins/:name/config/:key - Delete a config key
      .delete(
        "/plugins/:name/config/:key",
        describeRoute({
          tags: ["Config"],
          summary: "Delete config key",
          description: "Removes a configuration key from a plugin",
          parameters: [
            AuthHeader,
            PluginNameParam,
            {
              name: "key",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Config key to delete",
            },
          ],
          responses: {
            200: {
              description: "Config deleted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      plugin: { type: "string" },
                      key: { type: "string" },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:write");
          const name = decodeURIComponent(ctx.req.param("name"));
          const key = decodeURIComponent(ctx.req.param("key"));

          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }
          if (!key) {
            throw new ValidationError("Config key is required", "MISSING_KEY");
          }

          await deletePluginConfig(name, key);
          return ctx.json({ key, plugin: name, success: true });
        },
      )

      // DELETE /api/config/plugins/:name/config - Delete all config for a plugin
      .delete(
        "/plugins/:name/config",
        describeRoute({
          tags: ["Config"],
          summary: "Delete all plugin config",
          description: "Removes all configuration for a plugin",
          parameters: [AuthHeader, PluginNameParam],
          responses: {
            200: {
              description: "All config deleted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { success: { type: "boolean" }, plugin: { type: "string" } },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requirePermission(ctx, "config:write");
          const name = decodeURIComponent(ctx.req.param("name"));
          if (!name) {
            throw new ValidationError("Plugin name is required", "MISSING_NAME");
          }

          await deletePluginConfig(name);
          return ctx.json({ plugin: name, success: true });
        },
      )
  );
}

export type ConfigRoutesType = ReturnType<typeof createConfigRoutes>;
