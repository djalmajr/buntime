/**
 * SCIM 2.0 Routes
 *
 * Hono routes for SCIM endpoints
 */

import type { DatabaseAdapter } from "@buntime/plugin-database";
import type { PluginLogger } from "@buntime/shared/types";
import { Hono } from "hono";
import { ScimService, type ScimServiceConfig } from "./service";
import type {
  ScimBulkRequest,
  ScimBulkResponse,
  ScimError,
  ScimGroup,
  ScimPatchRequest,
  ScimResourceType,
  ScimSchema,
  ScimSchemaAttribute,
  ScimServiceProviderConfig,
  ScimUser,
} from "./types";
import { SCIM_CONTENT_TYPE, SCIM_SCHEMAS } from "./types";

/**
 * Configuration for SCIM routes
 */
export interface ScimRoutesConfig {
  adapter: DatabaseAdapter;
  baseUrl: string;
  bulkEnabled?: boolean;
  logger?: PluginLogger;
  maxBulkOperations?: number;
  maxResults?: number;
}

/**
 * Create SCIM routes
 */
export function createScimRoutes(config: ScimRoutesConfig): Hono {
  const serviceConfig: ScimServiceConfig = {
    baseUrl: config.baseUrl,
    bulkEnabled: config.bulkEnabled ?? true,
    maxBulkOperations: config.maxBulkOperations ?? 1000,
    maxResults: config.maxResults ?? 100,
  };

  const service = new ScimService(config.adapter, serviceConfig);
  const app = new Hono();

  // ===========================================================================
  // Middleware
  // ===========================================================================

  // SCIM Content-Type middleware
  app.use("*", async (ctx, next) => {
    await next();
    // Set SCIM content type for JSON responses
    if (ctx.res.headers.get("Content-Type")?.includes("application/json")) {
      ctx.res.headers.set("Content-Type", SCIM_CONTENT_TYPE);
    }
  });

  // Bearer token authentication middleware
  app.use("*", async (ctx, next) => {
    // Skip auth for discovery endpoints
    const path = ctx.req.path;
    if (
      path.endsWith("/ServiceProviderConfig") ||
      path.endsWith("/ResourceTypes") ||
      path.endsWith("/Schemas")
    ) {
      return next();
    }

    const authHeader = ctx.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return ctx.json(
        {
          schemas: [SCIM_SCHEMAS.ERROR],
          status: "401",
          detail: "Missing or invalid Authorization header",
        } as ScimError,
        401,
      );
    }

    const token = authHeader.substring(7);
    const valid = await service.validateToken(token);

    if (!valid) {
      return ctx.json(
        {
          schemas: [SCIM_SCHEMAS.ERROR],
          status: "401",
          detail: "Invalid or expired token",
        } as ScimError,
        401,
      );
    }

    return next();
  });

  // ===========================================================================
  // Discovery Endpoints
  // ===========================================================================

  /**
   * GET /ServiceProviderConfig
   */
  app.get("/ServiceProviderConfig", (ctx) => {
    const providerConfig: ScimServiceProviderConfig = {
      schemas: [SCIM_SCHEMAS.SERVICE_PROVIDER_CONFIG] as [
        "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
      ],
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "Authentication using Bearer tokens",
        },
      ],
      patch: { supported: true },
      bulk: {
        supported: serviceConfig.bulkEnabled ?? true,
        maxOperations: serviceConfig.maxBulkOperations ?? 1000,
        maxPayloadSize: 1048576, // 1MB
      },
      filter: {
        supported: true,
        maxResults: serviceConfig.maxResults ?? 100,
      },
      changePassword: { supported: false },
      sort: { supported: true },
      etag: { supported: false },
    };

    return ctx.json(providerConfig);
  });

  /**
   * GET /ResourceTypes
   */
  app.get("/ResourceTypes", (ctx) => {
    const resourceTypes: ScimResourceType[] = [
      {
        schemas: [SCIM_SCHEMAS.RESOURCE_TYPE] as [
          "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
        ],
        id: "User",
        name: "User",
        endpoint: "/Users",
        description: "User Account",
        schema: SCIM_SCHEMAS.USER,
      },
      {
        schemas: [SCIM_SCHEMAS.RESOURCE_TYPE] as [
          "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
        ],
        id: "Group",
        name: "Group",
        endpoint: "/Groups",
        description: "Group",
        schema: SCIM_SCHEMAS.GROUP,
      },
    ];

    return ctx.json(resourceTypes);
  });

  /**
   * GET /Schemas
   */
  app.get("/Schemas", (ctx) => {
    const schemas: ScimSchema[] = [getUserSchema(), getGroupSchema()];

    return ctx.json(schemas);
  });

  /**
   * GET /Schemas/:id
   */
  app.get("/Schemas/:id", (ctx) => {
    const id = ctx.req.param("id");

    if (id === SCIM_SCHEMAS.USER) {
      return ctx.json(getUserSchema());
    }

    if (id === SCIM_SCHEMAS.GROUP) {
      return ctx.json(getGroupSchema());
    }

    return ctx.json(
      {
        schemas: [SCIM_SCHEMAS.ERROR],
        status: "404",
        detail: `Schema ${id} not found`,
      } as ScimError,
      404,
    );
  });

  // ===========================================================================
  // User Endpoints
  // ===========================================================================

  /**
   * GET /Users
   */
  app.get("/Users", async (ctx) => {
    const filter = ctx.req.query("filter");
    const startIndex = Number.parseInt(ctx.req.query("startIndex") ?? "1", 10);
    const count = Number.parseInt(ctx.req.query("count") ?? String(serviceConfig.maxResults), 10);
    const sortBy = ctx.req.query("sortBy");
    const sortOrder = ctx.req.query("sortOrder") as "ascending" | "descending" | undefined;

    const result = await service.listUsers({ filter, startIndex, count, sortBy, sortOrder });
    return ctx.json(result);
  });

  /**
   * GET /Users/:id
   */
  app.get("/Users/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const result = await service.getUser(id);

    if ("status" in result && result.status === "404") {
      return ctx.json(result, 404);
    }

    return ctx.json(result);
  });

  /**
   * POST /Users
   */
  app.post("/Users", async (ctx) => {
    const body = await ctx.req.json<ScimUser>();
    const result = await service.createUser(body);

    if ("status" in result) {
      const status = Number.parseInt(result.status, 10);
      return ctx.json(result, status as 400 | 409 | 500);
    }

    return ctx.json(result, 201);
  });

  /**
   * PUT /Users/:id
   */
  app.put("/Users/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const body = await ctx.req.json<ScimUser>();
    const result = await service.replaceUser(id, body);

    if ("status" in result && result.status === "404") {
      return ctx.json(result, 404);
    }

    return ctx.json(result);
  });

  /**
   * PATCH /Users/:id
   */
  app.patch("/Users/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const body = await ctx.req.json<ScimPatchRequest>();
    const result = await service.patchUser(id, body.Operations);

    if ("status" in result && result.status === "404") {
      return ctx.json(result, 404);
    }

    return ctx.json(result);
  });

  /**
   * DELETE /Users/:id
   */
  app.delete("/Users/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const result = await service.deleteUser(id);

    if (result) {
      return ctx.json(result, 404);
    }

    return ctx.body(null, 204);
  });

  // ===========================================================================
  // Group Endpoints
  // ===========================================================================

  /**
   * GET /Groups
   */
  app.get("/Groups", async (ctx) => {
    const filter = ctx.req.query("filter");
    const startIndex = Number.parseInt(ctx.req.query("startIndex") ?? "1", 10);
    const count = Number.parseInt(ctx.req.query("count") ?? String(serviceConfig.maxResults), 10);
    const sortBy = ctx.req.query("sortBy");
    const sortOrder = ctx.req.query("sortOrder") as "ascending" | "descending" | undefined;

    const result = await service.listGroups({ filter, startIndex, count, sortBy, sortOrder });
    return ctx.json(result);
  });

  /**
   * GET /Groups/:id
   */
  app.get("/Groups/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const result = await service.getGroup(id);

    if ("status" in result && result.status === "404") {
      return ctx.json(result, 404);
    }

    return ctx.json(result);
  });

  /**
   * POST /Groups
   */
  app.post("/Groups", async (ctx) => {
    const body = await ctx.req.json<ScimGroup>();
    const result = await service.createGroup(body);

    if ("status" in result) {
      const status = Number.parseInt(result.status, 10);
      return ctx.json(result, status as 400 | 409 | 500);
    }

    return ctx.json(result, 201);
  });

  /**
   * PUT /Groups/:id
   */
  app.put("/Groups/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const body = await ctx.req.json<ScimGroup>();
    const result = await service.replaceGroup(id, body);

    if ("status" in result && result.status === "404") {
      return ctx.json(result, 404);
    }

    return ctx.json(result);
  });

  /**
   * PATCH /Groups/:id
   */
  app.patch("/Groups/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const body = await ctx.req.json<ScimPatchRequest>();
    const result = await service.patchGroup(id, body.Operations);

    if ("status" in result && result.status === "404") {
      return ctx.json(result, 404);
    }

    return ctx.json(result);
  });

  /**
   * DELETE /Groups/:id
   */
  app.delete("/Groups/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const result = await service.deleteGroup(id);

    if (result) {
      return ctx.json(result, 404);
    }

    return ctx.body(null, 204);
  });

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /**
   * POST /Bulk
   */
  app.post("/Bulk", async (ctx) => {
    if (!serviceConfig.bulkEnabled) {
      return ctx.json(
        {
          schemas: [SCIM_SCHEMAS.ERROR],
          status: "501",
          detail: "Bulk operations are not enabled",
        } as ScimError,
        501,
      );
    }

    const body = await ctx.req.json<ScimBulkRequest>();
    const operations = body.Operations;
    const failOnErrors = body.failOnErrors ?? 0;

    if (operations.length > (serviceConfig.maxBulkOperations ?? 1000)) {
      return ctx.json(
        {
          schemas: [SCIM_SCHEMAS.ERROR],
          status: "413",
          detail: `Too many operations. Maximum is ${serviceConfig.maxBulkOperations ?? 1000}`,
        } as ScimError,
        413,
      );
    }

    const response: ScimBulkResponse = {
      schemas: [SCIM_SCHEMAS.BULK_RESPONSE] as [
        "urn:ietf:params:scim:api:messages:2.0:BulkResponse",
      ],
      Operations: [],
    };

    let errorCount = 0;

    for (const op of operations) {
      if (failOnErrors > 0 && errorCount >= failOnErrors) {
        break;
      }

      try {
        const result = await processBulkOperation(service, op, config.baseUrl);
        response.Operations.push(result);

        if (result.status.startsWith("4") || result.status.startsWith("5")) {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
        response.Operations.push({
          method: op.method,
          bulkId: op.bulkId,
          status: "500",
          response: {
            schemas: [SCIM_SCHEMAS.ERROR] as ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "500",
            detail: String(err),
          },
        });
      }
    }

    return ctx.json(response);
  });

  return app;
}

/**
 * Process a single bulk operation
 */
async function processBulkOperation(
  service: ScimService,
  op: ScimBulkRequest["Operations"][0],
  baseUrl: string,
) {
  const { method, path, data, bulkId } = op;

  // Parse path to determine resource type and ID
  const pathMatch = path.match(/\/(Users|Groups)(?:\/([^/]+))?/);
  if (!pathMatch) {
    return {
      method,
      bulkId,
      status: "400",
      response: {
        schemas: [SCIM_SCHEMAS.ERROR] as ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        detail: `Invalid path: ${path}`,
      },
    };
  }

  const resourceType = pathMatch[1] as "Groups" | "Users";
  const resourceId = pathMatch[2];

  switch (method) {
    case "POST": {
      if (resourceType === "Users") {
        const result = await service.createUser(data as ScimUser);
        if ("status" in result) {
          return { method, bulkId, status: result.status, response: result };
        }
        return {
          method,
          bulkId,
          status: "201",
          location: `${baseUrl}/scim/v2/Users/${result.id}`,
          response: result,
        };
      }
      const result = await service.createGroup(data as ScimGroup);
      if ("status" in result) {
        return { method, bulkId, status: result.status, response: result };
      }
      return {
        method,
        bulkId,
        status: "201",
        location: `${baseUrl}/scim/v2/Groups/${result.id}`,
        response: result,
      };
    }

    case "PUT": {
      if (!resourceId) {
        return {
          method,
          bulkId,
          status: "400",
          response: {
            schemas: [SCIM_SCHEMAS.ERROR] as ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "400",
            detail: "Resource ID required for PUT",
          },
        };
      }

      if (resourceType === "Users") {
        const result = await service.replaceUser(resourceId, data as ScimUser);
        const status = "status" in result ? result.status : "200";
        return { method, bulkId, status, response: result };
      }
      const result = await service.replaceGroup(resourceId, data as ScimGroup);
      const status = "status" in result ? result.status : "200";
      return { method, bulkId, status, response: result };
    }

    case "PATCH": {
      if (!resourceId) {
        return {
          method,
          bulkId,
          status: "400",
          response: {
            schemas: [SCIM_SCHEMAS.ERROR] as ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "400",
            detail: "Resource ID required for PATCH",
          },
        };
      }

      const patchData = data as ScimPatchRequest;
      if (resourceType === "Users") {
        const result = await service.patchUser(resourceId, patchData.Operations);
        const status = "status" in result ? result.status : "200";
        return { method, bulkId, status, response: result };
      }
      const result = await service.patchGroup(resourceId, patchData.Operations);
      const status = "status" in result ? result.status : "200";
      return { method, bulkId, status, response: result };
    }

    case "DELETE": {
      if (!resourceId) {
        return {
          method,
          bulkId,
          status: "400",
          response: {
            schemas: [SCIM_SCHEMAS.ERROR] as ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "400",
            detail: "Resource ID required for DELETE",
          },
        };
      }

      if (resourceType === "Users") {
        const result = await service.deleteUser(resourceId);
        return { method, bulkId, status: result ? result.status : "204" };
      }
      const result = await service.deleteGroup(resourceId);
      return { method, bulkId, status: result ? result.status : "204" };
    }

    default:
      return {
        method,
        bulkId,
        status: "400",
        response: {
          schemas: [SCIM_SCHEMAS.ERROR] as ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "400",
          detail: `Unsupported method: ${method}`,
        },
      };
  }
}

// ===========================================================================
// Schema Definitions
// ===========================================================================

function getUserSchema(): ScimSchema {
  const attributes: ScimSchemaAttribute[] = [
    {
      name: "userName",
      type: "string",
      multiValued: false,
      description: "Unique identifier for the User",
      required: true,
      caseExact: false,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "server",
    },
    {
      name: "name",
      type: "complex",
      multiValued: false,
      description: "The components of the user's name",
      required: false,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "none",
      subAttributes: [
        {
          name: "formatted",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "familyName",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "givenName",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
      ],
    },
    {
      name: "displayName",
      type: "string",
      multiValued: false,
      description: "The name of the User",
      required: false,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "none",
    },
    {
      name: "active",
      type: "boolean",
      multiValued: false,
      description: "A Boolean value indicating the User's administrative status",
      required: false,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "none",
    },
    {
      name: "emails",
      type: "complex",
      multiValued: true,
      description: "Email addresses for the user",
      required: false,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "none",
      subAttributes: [
        {
          name: "value",
          type: "string",
          multiValued: false,
          required: true,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "type",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "primary",
          type: "boolean",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
      ],
    },
    {
      name: "groups",
      type: "complex",
      multiValued: true,
      description: "A list of groups to which the user belongs",
      required: false,
      mutability: "readOnly",
      returned: "default",
      uniqueness: "none",
      subAttributes: [
        {
          name: "value",
          type: "string",
          multiValued: false,
          required: true,
          mutability: "readOnly",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "$ref",
          type: "reference",
          multiValued: false,
          required: false,
          mutability: "readOnly",
          returned: "default",
          uniqueness: "none",
          referenceTypes: ["Group"],
        },
        {
          name: "display",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readOnly",
          returned: "default",
          uniqueness: "none",
        },
      ],
    },
  ];

  return {
    schemas: [SCIM_SCHEMAS.SCHEMA] as ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
    id: SCIM_SCHEMAS.USER,
    name: "User",
    description: "User Account",
    attributes,
  };
}

function getGroupSchema(): ScimSchema {
  const attributes: ScimSchemaAttribute[] = [
    {
      name: "displayName",
      type: "string",
      multiValued: false,
      description: "A human-readable name for the Group",
      required: true,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "none",
    },
    {
      name: "members",
      type: "complex",
      multiValued: true,
      description: "A list of members of the Group",
      required: false,
      mutability: "readWrite",
      returned: "default",
      uniqueness: "none",
      subAttributes: [
        {
          name: "value",
          type: "string",
          multiValued: false,
          required: true,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "$ref",
          type: "reference",
          multiValued: false,
          required: false,
          mutability: "readOnly",
          returned: "default",
          uniqueness: "none",
          referenceTypes: ["User", "Group"],
        },
        {
          name: "display",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readOnly",
          returned: "default",
          uniqueness: "none",
        },
      ],
    },
  ];

  return {
    schemas: [SCIM_SCHEMAS.SCHEMA] as ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
    id: SCIM_SCHEMAS.GROUP,
    name: "Group",
    description: "Group",
    attributes,
  };
}
