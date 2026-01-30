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
