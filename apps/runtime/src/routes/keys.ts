import { ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  ALL_PERMISSIONS,
  type ApiKeyStore,
  type CreateApiKeyInput,
  KEY_ROLES,
} from "@/libs/api-keys";
import { SuccessResponse } from "@/libs/openapi";

interface KeysRoutesDeps {
  store: ApiKeyStore;
}

function parseKeyId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("Invalid API key id", "INVALID_KEY_ID");
  }
  return id;
}

export function createKeysRoutes({ store }: KeysRoutesDeps) {
  return new Hono()
    .get(
      "/",
      describeRoute({
        description: "Returns non-revoked runtime API keys without secret values",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    keys: { items: { type: "object" }, type: "array" },
                  },
                  type: "object",
                },
              },
            },
            description: "List of API keys",
          },
        },
        summary: "List API keys",
        tags: ["API Keys"],
      }),
      async (ctx) => {
        return ctx.json({ keys: await store.list() });
      },
    )
    .get(
      "/meta",
      describeRoute({
        description: "Returns supported API key roles and permissions",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    permissions: { items: { type: "string" }, type: "array" },
                    roles: { items: { type: "string" }, type: "array" },
                  },
                  type: "object",
                },
              },
            },
            description: "Roles and permissions",
          },
        },
        summary: "API key metadata",
        tags: ["API Keys"],
      }),
      (ctx) => ctx.json({ permissions: ALL_PERMISSIONS, roles: KEY_ROLES }),
    )
    .post(
      "/",
      describeRoute({
        description: "Creates a runtime API key. The secret value is returned once.",
        responses: {
          201: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    data: { type: "object" },
                    success: { type: "boolean" },
                  },
                  type: "object",
                },
              },
            },
            description: "API key created",
          },
        },
        summary: "Create API key",
        tags: ["API Keys"],
      }),
      async (ctx) => {
        const input = (await ctx.req.json()) as CreateApiKeyInput;
        const result = await store.create(input);
        return ctx.json({ data: result, success: true }, 201);
      },
    )
    .delete(
      "/:id",
      describeRoute({
        description: "Revokes a runtime API key",
        parameters: [
          {
            description: "API key id",
            in: "path",
            name: "id",
            required: true,
            schema: { type: "integer" },
          },
        ],
        responses: {
          200: {
            content: { "application/json": { schema: SuccessResponse } },
            description: "API key revoked",
          },
        },
        summary: "Revoke API key",
        tags: ["API Keys"],
      }),
      async (ctx) => {
        await store.revoke(parseKeyId(ctx.req.param("id")));
        return ctx.json({ success: true });
      },
    );
}
