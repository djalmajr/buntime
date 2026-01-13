/**
 * Shared OpenAPI Schemas
 *
 * Common schema definitions used across all API routes.
 */

/**
 * Standard error response schema
 */
export const ErrorResponse = {
  type: "object" as const,
  properties: {
    code: { type: "string" as const, example: "ERROR_CODE" },
    error: { type: "string" as const, example: "Error message" },
  },
  required: ["error", "code"],
};

/**
 * Standard success response with data
 */
export const SuccessResponse = {
  type: "object" as const,
  properties: {
    success: { type: "boolean" as const, example: true },
  },
  required: ["success"],
};

/**
 * Authorization header parameter
 */
export const AuthHeader = {
  name: "Authorization",
  in: "header" as const,
  description: "API key (format: Bearer bt_xxx)",
  required: true,
  schema: { type: "string" as const, example: "Bearer bt_abc123..." },
};

/**
 * ID path parameter
 */
export const IdParam = {
  name: "id",
  in: "path" as const,
  description: "Resource ID",
  required: true,
  schema: { type: "integer" as const, minimum: 1 },
};

/**
 * Plugin name path parameter
 */
export const PluginNameParam = {
  name: "name",
  in: "path" as const,
  description: "Plugin name (e.g., @buntime/plugin-keyval)",
  required: true,
  schema: { type: "string" as const },
};

/**
 * Common error responses
 */
export const CommonErrors = {
  401: {
    description: "Authentication required",
    content: {
      "application/json": {
        schema: ErrorResponse,
        example: { code: "AUTH_REQUIRED", error: "Authentication required" },
      },
    },
  },
  403: {
    description: "Permission denied",
    content: {
      "application/json": {
        schema: ErrorResponse,
        example: { code: "PERMISSION_DENIED", error: "Permission denied" },
      },
    },
  },
  404: {
    description: "Resource not found",
    content: {
      "application/json": {
        schema: ErrorResponse,
        example: { code: "NOT_FOUND", error: "Resource not found" },
      },
    },
  },
  422: {
    description: "Validation error",
    content: {
      "application/json": {
        schema: ErrorResponse,
        example: { code: "VALIDATION_ERROR", error: "Invalid input" },
      },
    },
  },
};

/**
 * Plugin info schema (for /api/plugins)
 */
export const PluginInfoSchema = {
  type: "object" as const,
  properties: {
    base: { type: "string" as const, example: "/keyval" },
    dependencies: {
      type: "array" as const,
      items: { type: "string" as const },
      example: ["@buntime/plugin-database"],
    },
    fragment: {
      type: "object" as const,
      properties: {
        enabled: { type: "boolean" as const },
        origin: { type: "string" as const },
        preloadStyles: { type: "array" as const, items: { type: "string" as const } },
        type: { type: "string" as const, enum: ["patch", "iframe"] },
      },
    },
    menus: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          icon: { type: "string" as const, example: "lucide:database" },
          items: { type: "array" as const, items: { type: "object" as const } },
          path: { type: "string" as const, example: "/keyval" },
          priority: { type: "integer" as const },
          title: { type: "string" as const, example: "KeyVal" },
        },
      },
    },
    name: { type: "string" as const, example: "@buntime/plugin-keyval" },
    optionalDependencies: {
      type: "array" as const,
      items: { type: "string" as const },
    },
  },
};

/**
 * Plugin data schema (for /api/core/plugins)
 */
export const PluginDataSchema = {
  type: "object" as const,
  properties: {
    base: { type: "string" as const, example: "/keyval" },
    config: { type: "object" as const },
    enabled: { type: "boolean" as const },
    id: { type: "integer" as const },
    name: { type: "string" as const, example: "@buntime/plugin-keyval" },
    path: { type: "string" as const, example: "/plugins/@buntime/plugin-keyval" },
    updatedAt: { type: "integer" as const },
    version: { type: "string" as const, example: "latest" },
    versions: { type: "array" as const, items: { type: "string" as const } },
  },
};

/**
 * App info schema
 */
export const AppInfoSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const, example: "my-app" },
    path: { type: "string" as const, example: "/apps/my-app" },
    versions: {
      type: "array" as const,
      items: { type: "string" as const },
      example: ["1.0.0", "latest"],
    },
  },
};

/**
 * API Key schema
 */
export const ApiKeySchema = {
  type: "object" as const,
  properties: {
    createdAt: { type: "integer" as const },
    createdBy: { type: "integer" as const, nullable: true },
    description: { type: "string" as const, nullable: true },
    expiresAt: { type: "integer" as const, nullable: true },
    id: { type: "integer" as const },
    keyPrefix: { type: "string" as const, example: "bt_abc" },
    lastUsedAt: { type: "integer" as const, nullable: true },
    name: { type: "string" as const, example: "Production API" },
    permissions: {
      type: "array" as const,
      items: { type: "string" as const },
      nullable: true,
    },
    revokedAt: { type: "integer" as const, nullable: true },
    role: {
      type: "string" as const,
      enum: ["root", "admin", "editor", "viewer", "custom"],
    },
  },
};

/**
 * Health response schema
 */
export const HealthSchema = {
  type: "object" as const,
  properties: {
    ok: { type: "boolean" as const, example: true },
    status: { type: "string" as const, example: "healthy" },
    version: { type: "string" as const, example: "1.0.0" },
  },
};
