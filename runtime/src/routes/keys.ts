/**
 * Keys API Routes (/api/keys)
 *
 * Provides API key management endpoints for:
 * - Listing API keys
 * - Creating new keys
 * - Updating key metadata (name, description)
 * - Revoking keys
 * - Listing audit logs
 *
 * Authorization:
 * - root: Full access, can create any role including admin
 * - admin: Full access, can create editor/viewer/custom keys
 * - keys:read permission: Can list keys
 * - keys:create permission: Can create keys (limited by role hierarchy)
 * - keys:revoke permission: Can revoke keys
 */

import { ForbiddenError, NotFoundError, ValidationError } from "@buntime/shared/errors";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  type CreateKeyInput,
  canCreateRole,
  createApiKey,
  getAllApiKeys,
  getApiKeyById,
  getValidPermissions,
  getValidRoles,
  hasPermission,
  type KeyRole,
  type Permission,
  revokeApiKey,
  updateApiKey,
  type ValidatedKey,
} from "@/libs/api-keys";
import {
  type AuditAction,
  getAuditLogs,
  logKeyCreate,
  logKeyRevoke,
  logKeyUpdate,
} from "@/libs/audit";
import type { AppEnv } from "@/libs/hono-context";
import {
  ApiKeySchema,
  AuthHeader,
  CommonErrors,
  IdParam,
  SuccessResponse,
} from "@/libs/openapi";

// ============================================================================
// Helpers
// ============================================================================

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
 * Require root or admin access
 */
function requireRootOrAdmin(ctx: Context): ValidatedKey {
  const key = getValidatedKey(ctx);

  if (!key) {
    throw new ForbiddenError("Authentication required", "AUTH_REQUIRED");
  }

  if (key.role !== "root" && key.role !== "admin") {
    throw new ForbiddenError("Admin access required", "ADMIN_REQUIRED");
  }

  return key;
}

/**
 * Parse and validate id parameter
 */
function parseId(idParam: string | undefined): number {
  if (!idParam) {
    throw new ValidationError("Key ID is required", "MISSING_ID");
  }
  const id = parseInt(idParam, 10);
  if (Number.isNaN(id) || id < 1) {
    throw new ValidationError("Invalid key ID", "INVALID_ID");
  }
  return id;
}

/**
 * Parse expiration string to timestamp
 * Supports: "30d", "90d", "1y", or ISO date string
 */
function parseExpiration(expiresIn: string | undefined): number | null {
  if (!expiresIn || expiresIn === "never") return null;

  const now = Math.floor(Date.now() / 1000);

  // Check for duration format (e.g., "30d", "90d", "1y")
  const durationMatch = expiresIn.match(/^(\d+)(d|m|y)$/);
  if (durationMatch) {
    const value = parseInt(durationMatch[1]!, 10);
    const unit = durationMatch[2]!;

    switch (unit) {
      case "d":
        return now + value * 24 * 60 * 60;
      case "m":
        return now + value * 30 * 24 * 60 * 60;
      case "y":
        return now + value * 365 * 24 * 60 * 60;
    }
  }

  // Try parsing as ISO date
  const date = new Date(expiresIn);
  if (!Number.isNaN(date.getTime())) {
    return Math.floor(date.getTime() / 1000);
  }

  throw new ValidationError(
    "Invalid expiration format. Use '30d', '90d', '1y', 'never', or ISO date",
    "INVALID_EXPIRATION",
  );
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Create keys core routes
 */
export function createKeysRoutes() {
  return (
    new Hono()
      // List all API keys
      .get(
        "/",
        describeRoute({
          tags: ["API Keys"],
          summary: "List API keys",
          description: "Returns all API keys (filtered by role)",
          parameters: [AuthHeader],
          responses: {
            200: {
              description: "List of API keys",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { keys: { type: "array", items: ApiKeySchema } },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "keys:read");

          const keys = await getAllApiKeys();

          // Filter: non-admin users can only see their own keys and keys they created
          const filteredKeys =
            actor.role === "root" || actor.role === "admin"
              ? keys
              : keys.filter((k) => k.id === actor.id || k.createdBy === actor.id);

          return ctx.json({ keys: filteredKeys });
        },
      )

      // Get available roles and permissions (for UI)
      .get(
        "/meta",
        describeRoute({
          tags: ["API Keys"],
          summary: "Get available roles and permissions",
          description: "Returns available roles and permissions for key creation",
          responses: {
            200: {
              description: "Roles and permissions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      permissions: { type: "array", items: { type: "string" } },
                      roles: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        }),
        (ctx) => {
          // This endpoint doesn't require auth - useful for UI to know what options are available
          return ctx.json({
            permissions: getValidPermissions(),
            roles: getValidRoles(),
          });
        },
      )

      // Create a new API key
      .post(
        "/",
        describeRoute({
          tags: ["API Keys"],
          summary: "Create API key",
          description: "Creates a new API key",
          parameters: [AuthHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    expiresIn: {
                      type: "string",
                      example: "90d",
                      description: "Duration (30d, 90d, 1y) or ISO date",
                    },
                    name: { type: "string", example: "Production API" },
                    permissions: { type: "array", items: { type: "string" } },
                    role: { type: "string", enum: ["admin", "editor", "viewer", "custom"] },
                  },
                  required: ["name", "role"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Key created successfully (key is only shown once!)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          id: { type: "integer" },
                          key: {
                            type: "string",
                            description: "Full API key (only returned on creation)",
                          },
                          keyPrefix: { type: "string" },
                          name: { type: "string" },
                          role: { type: "string" },
                        },
                      },
                      success: { type: "boolean" },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "keys:create");

          const body = await ctx.req.json<{
            description?: string;
            expiresIn?: string;
            name: string;
            permissions?: Permission[];
            role: KeyRole;
          }>();

          // Validate required fields
          if (!body.name?.trim()) {
            throw new ValidationError("Name is required", "MISSING_NAME");
          }

          if (!body.role) {
            throw new ValidationError("Role is required", "MISSING_ROLE");
          }

          // Validate role
          const validRoles = getValidRoles();
          if (!validRoles.includes(body.role)) {
            throw new ValidationError(
              `Invalid role. Must be one of: ${validRoles.join(", ")}`,
              "INVALID_ROLE",
            );
          }

          // Check if actor can create this role
          if (!canCreateRole(actor.role, body.role)) {
            throw new ForbiddenError(
              `Cannot create ${body.role} keys. Only root can create admin keys.`,
              "CANNOT_CREATE_ROLE",
            );
          }

          // Validate permissions for custom role
          if (body.role === "custom") {
            if (!body.permissions || body.permissions.length === 0) {
              throw new ValidationError(
                "Permissions required for custom role",
                "MISSING_PERMISSIONS",
              );
            }

            const validPerms = getValidPermissions();
            for (const perm of body.permissions) {
              if (!validPerms.includes(perm)) {
                throw new ValidationError(`Invalid permission: ${perm}`, "INVALID_PERMISSION");
              }
            }
          }

          // Parse expiration
          const expiresAt = parseExpiration(body.expiresIn);

          // Create the key
          const input: CreateKeyInput = {
            createdBy: actor.id,
            description: body.description,
            expiresAt,
            name: body.name.trim(),
            permissions: body.permissions,
            role: body.role,
          };

          const result = await createApiKey(input);

          // Log the action
          await logKeyCreate(actor, result.id, result.name, { role: result.role });

          return ctx.json({
            data: {
              id: result.id,
              key: result.key, // Only returned here, never again!
              keyPrefix: result.keyPrefix,
              name: result.name,
              role: result.role,
            },
            success: true,
          });
        },
      )

      // Get a single key by ID
      .get(
        "/:id",
        describeRoute({
          tags: ["API Keys"],
          summary: "Get API key",
          description: "Returns details of a specific API key",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "API key details",
              content: { "application/json": { schema: ApiKeySchema } },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "keys:read");
          const id = parseId(ctx.req.param("id"));

          const key = await getApiKeyById(id);
          if (!key) {
            throw new NotFoundError("Key not found", "KEY_NOT_FOUND");
          }

          // Non-admin users can only see their own keys or keys they created
          if (actor.role !== "root" && actor.role !== "admin") {
            if (key.id !== actor.id && key.createdBy !== actor.id) {
              throw new ForbiddenError("Cannot view this key", "PERMISSION_DENIED");
            }
          }

          return ctx.json(key);
        },
      )

      // Update a key (name and description only)
      .put(
        "/:id",
        describeRoute({
          tags: ["API Keys"],
          summary: "Update API key",
          description: "Updates name and description of an API key",
          parameters: [AuthHeader, IdParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { description: { type: "string" }, name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Key updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { data: ApiKeySchema, success: { type: "boolean" } },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requireRootOrAdmin(ctx);
          const id = parseId(ctx.req.param("id"));

          const existing = await getApiKeyById(id);
          if (!existing) {
            throw new NotFoundError("Key not found", "KEY_NOT_FOUND");
          }

          const body = await ctx.req.json<{
            description?: string;
            name?: string;
          }>();

          const updated = await updateApiKey(id, {
            description: body.description,
            name: body.name,
          });

          if (!updated) {
            throw new NotFoundError("Key not found", "KEY_NOT_FOUND");
          }

          // Log the action
          await logKeyUpdate(actor, id, updated.name, {
            description: body.description,
            name: body.name,
          });

          return ctx.json({ data: updated, success: true });
        },
      )

      // Revoke a key
      .delete(
        "/:id",
        describeRoute({
          tags: ["API Keys"],
          summary: "Revoke API key",
          description: "Revokes an API key (cannot be undone)",
          parameters: [AuthHeader, IdParam],
          responses: {
            200: {
              description: "Key revoked",
              content: { "application/json": { schema: SuccessResponse } },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "keys:revoke");
          const id = parseId(ctx.req.param("id"));

          const existing = await getApiKeyById(id);
          if (!existing) {
            throw new NotFoundError("Key not found", "KEY_NOT_FOUND");
          }

          // Prevent revoking own key
          if (actor.id === id) {
            throw new ValidationError("Cannot revoke your own key", "CANNOT_REVOKE_SELF");
          }

          // Non-admin can only revoke keys they created
          if (actor.role !== "root" && actor.role !== "admin") {
            if (existing.createdBy !== actor.id) {
              throw new ForbiddenError("Cannot revoke this key", "PERMISSION_DENIED");
            }
          }

          const revoked = await revokeApiKey(id);
          if (!revoked) {
            throw new ValidationError("Key already revoked or not found", "REVOKE_FAILED");
          }

          // Log the action
          await logKeyRevoke(actor, id, existing.name);

          return ctx.json({ success: true });
        },
      )

      // Clone a key (create new key with same settings)
      .post(
        "/:id/clone",
        describeRoute({
          tags: ["API Keys"],
          summary: "Clone API key",
          description: "Creates a new key with same settings as an existing key",
          parameters: [AuthHeader, IdParam],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { expiresIn: { type: "string" }, name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Key cloned successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: {
                          id: { type: "integer" },
                          key: { type: "string" },
                          keyPrefix: { type: "string" },
                          name: { type: "string" },
                          role: { type: "string" },
                        },
                      },
                      success: { type: "boolean" },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          const actor = requirePermission(ctx, "keys:create");
          const id = parseId(ctx.req.param("id"));

          const source = await getApiKeyById(id);
          if (!source) {
            throw new NotFoundError("Key not found", "KEY_NOT_FOUND");
          }

          // Check if actor can create this role
          if (!canCreateRole(actor.role, source.role)) {
            throw new ForbiddenError(`Cannot clone ${source.role} keys`, "CANNOT_CREATE_ROLE");
          }

          const body = await ctx.req.json<{
            expiresIn?: string;
            name?: string;
          }>();

          const name = body.name?.trim() || `${source.name} (copy)`;
          const expiresAt = parseExpiration(body.expiresIn);

          const input: CreateKeyInput = {
            createdBy: actor.id,
            description: source.description ?? undefined,
            expiresAt,
            name,
            permissions: source.permissions,
            role: source.role,
          };

          const result = await createApiKey(input);

          // Log the action
          await logKeyCreate(actor, result.id, result.name, { clonedFrom: id, role: result.role });

          return ctx.json({
            data: {
              id: result.id,
              key: result.key,
              keyPrefix: result.keyPrefix,
              name: result.name,
              role: result.role,
            },
            success: true,
          });
        },
      )

      // Get audit logs (admin only)
      .get(
        "/audit",
        describeRoute({
          tags: ["API Keys"],
          summary: "Get audit logs",
          description: "Returns audit logs (admin only)",
          parameters: [
            AuthHeader,
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
            {
              name: "action",
              in: "query",
              schema: { type: "string" },
              description: "Filter by action type",
            },
            {
              name: "actor_id",
              in: "query",
              schema: { type: "integer" },
              description: "Filter by actor ID",
            },
          ],
          responses: {
            200: {
              description: "Audit logs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      logs: { type: "array", items: { type: "object" } },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
            ...CommonErrors,
          },
        }),
        async (ctx) => {
          requireRootOrAdmin(ctx);

          const url = new URL(ctx.req.url);
          const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
          const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
          const action = url.searchParams.get("action") as AuditAction | null;
          const actorId = url.searchParams.get("actor_id");

          const result = await getAuditLogs({
            action: action ?? undefined,
            actorId: actorId ? parseInt(actorId, 10) : undefined,
            limit: Math.min(limit, 200),
            offset,
          });

          return ctx.json(result);
        },
      )
  );
}

export type KeysRoutesType = ReturnType<typeof createKeysRoutes>;
