import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "@/config";
import { Headers } from "@/constants";
import { ALL_PERMISSIONS, type ApiKeyPrincipal, type ApiKeyStore } from "@/libs/api-keys";

interface AdminRoutesDeps {
  masterKey?: string;
  store: ApiKeyStore;
}

interface AdminPrincipalResponse {
  id: number;
  isMaster?: boolean;
  keyPrefix: string;
  name: string;
  permissions: string[];
  role: string;
}

function toMasterPrincipal(): ApiKeyPrincipal {
  return {
    createdAt: 0,
    id: 0,
    isMaster: true,
    keyPrefix: "master",
    name: "master",
    permissions: [],
    role: "admin",
  };
}

function toResponsePrincipal(principal: ApiKeyPrincipal): AdminPrincipalResponse {
  return {
    id: principal.id,
    ...(principal.isMaster ? { isMaster: true } : {}),
    keyPrefix: principal.keyPrefix,
    name: principal.name,
    permissions:
      principal.isMaster || principal.role === "admin"
        ? [...ALL_PERMISSIONS]
        : [...principal.permissions],
    role: principal.role,
  };
}

async function resolveAdminPrincipal(
  req: Request,
  store: ApiKeyStore,
  configuredMasterKey?: string,
): Promise<ApiKeyPrincipal | null> {
  const suppliedKey = req.headers.get(Headers.API_KEY)?.trim();
  if (!suppliedKey) return null;

  const masterKey = configuredMasterKey ?? getConfig().apiKey;
  if (masterKey && suppliedKey === masterKey) {
    return toMasterPrincipal();
  }

  return store.verify(suppliedKey);
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ code: "AUTH_REQUIRED", error: "Unauthorized" }), {
    headers: { "Content-Type": "application/json" },
    status: 401,
  });
}

export function createAdminRoutes({ masterKey, store }: AdminRoutesDeps) {
  return new Hono().get(
    "/session",
    describeRoute({
      description:
        "Validates an admin X-API-Key and returns the effective runtime API permissions.",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  authenticated: { type: "boolean" },
                  principal: { type: "object" },
                },
                type: "object",
              },
            },
          },
          description: "Authenticated admin session",
        },
        401: {
          description: "Missing or invalid X-API-Key",
        },
      },
      summary: "Get admin session",
      tags: ["Admin"],
    }),
    async (ctx) => {
      const principal = await resolveAdminPrincipal(ctx.req.raw, store, masterKey);
      if (!principal) return unauthorizedResponse();

      return ctx.json({
        authenticated: true,
        principal: toResponsePrincipal(principal),
      });
    },
  );
}

export type AdminRoutesType = ReturnType<typeof createAdminRoutes>;
