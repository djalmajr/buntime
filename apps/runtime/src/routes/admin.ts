import { extractApiKey } from "@buntime/shared/middleware/api-key";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { describeRoute } from "hono-openapi";
import { getConfig } from "@/config";
import { ALL_PERMISSIONS, type ApiKeyPrincipal, type ApiKeyStore } from "@/libs/api-keys";

/** Cookie name used by the cpanel session — mirrored by the shared extractor. */
const SESSION_COOKIE = "buntime_api_key";

interface AdminRoutesDeps {
  rootKey?: string;
  store: ApiKeyStore;
}

interface AdminPrincipalResponse {
  id: number;
  isRoot?: boolean;
  keyPrefix: string;
  name: string;
  namespaces: string[];
  permissions: string[];
  role: string;
}

function toRootPrincipal(): ApiKeyPrincipal {
  return {
    createdAt: 0,
    id: 0,
    isRoot: true,
    keyPrefix: "root",
    name: "root",
    namespaces: ["*"],
    permissions: [],
    role: "admin",
  };
}

function toResponsePrincipal(principal: ApiKeyPrincipal): AdminPrincipalResponse {
  return {
    id: principal.id,
    ...(principal.isRoot ? { isRoot: true } : {}),
    keyPrefix: principal.keyPrefix,
    name: principal.name,
    namespaces: [...principal.namespaces],
    permissions:
      principal.isRoot || principal.role === "admin"
        ? [...ALL_PERMISSIONS]
        : [...principal.permissions],
    role: principal.role,
  };
}

/**
 * Resolve the operator principal for an admin endpoint. Accepts the runtime
 * root key, the session cookie, or any of the credentials honored by
 * `extractApiKey` (X-API-Key, Bearer). Returns `null` when no credentials
 * are presented or the key is invalid.
 */
async function resolveAdminPrincipal(
  req: Request,
  store: ApiKeyStore,
  configuredRootKey?: string,
): Promise<ApiKeyPrincipal | null> {
  const suppliedKey = extractApiKey(req);
  if (!suppliedKey) return null;

  const rootKey = configuredRootKey ?? getConfig().apiKey;
  if (rootKey && suppliedKey === rootKey) {
    return toRootPrincipal();
  }

  return store.verify(suppliedKey);
}

/**
 * Validate a candidate key against the root key or store. Used by the
 * session-login endpoint, which receives the key in the request body rather
 * than via the standard extractors.
 */
async function validateCandidateKey(
  candidate: string,
  store: ApiKeyStore,
  configuredRootKey?: string,
): Promise<ApiKeyPrincipal | null> {
  const rootKey = configuredRootKey ?? getConfig().apiKey;
  if (rootKey && candidate === rootKey) return toRootPrincipal();
  return store.verify(candidate);
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ code: "AUTH_REQUIRED", error: "Unauthorized" }), {
    headers: { "Content-Type": "application/json" },
    status: 401,
  });
}

function invalidKeyResponse() {
  return new Response(JSON.stringify({ code: "INVALID_KEY", error: "Invalid API key" }), {
    headers: { "Content-Type": "application/json" },
    status: 401,
  });
}

function badRequestResponse(message: string) {
  return new Response(JSON.stringify({ code: "BAD_REQUEST", error: message }), {
    headers: { "Content-Type": "application/json" },
    status: 400,
  });
}

/** Detect HTTPS from the request URL — drives the cookie `Secure` flag. */
function isSecureRequest(req: Request): boolean {
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function createAdminRoutes({ rootKey, store }: AdminRoutesDeps) {
  return new Hono()
    .get(
      "/session",
      describeRoute({
        description:
          "Validates an admin credential (X-API-Key, Authorization: Bearer, " +
          "or session cookie) and returns the effective runtime principal.",
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
            description: "Missing or invalid credentials",
          },
        },
        summary: "Get admin session",
        tags: ["Admin"],
      }),
      async (ctx) => {
        const principal = await resolveAdminPrincipal(ctx.req.raw, store, rootKey);
        if (!principal) return unauthorizedResponse();

        return ctx.json({
          authenticated: true,
          principal: toResponsePrincipal(principal),
        });
      },
    )
    .post(
      "/session",
      describeRoute({
        description:
          "Exchanges an API key for an HttpOnly session cookie. Used by the " +
          "cpanel login form so that subsequent same-origin requests (including " +
          "plugin iframes that cannot inject headers) authenticate automatically.",
        responses: {
          200: { description: "Cookie issued; principal returned" },
          400: { description: "Malformed body or missing `key`" },
          401: { description: "Invalid key" },
        },
        summary: "Create admin session cookie",
        tags: ["Admin"],
      }),
      async (ctx) => {
        let body: unknown;
        try {
          body = await ctx.req.json();
        } catch {
          return badRequestResponse("Request body must be JSON");
        }
        const candidate =
          typeof body === "object" && body !== null && "key" in body
            ? (body as { key?: unknown }).key
            : undefined;
        if (typeof candidate !== "string" || candidate.trim().length === 0) {
          return badRequestResponse("Missing `key` in request body");
        }

        const principal = await validateCandidateKey(candidate.trim(), store, rootKey);
        if (!principal) return invalidKeyResponse();

        const ttlMs = getConfig().cpanelSessionTtlMs;
        setCookie(ctx, SESSION_COOKIE, candidate.trim(), {
          httpOnly: true,
          maxAge: Math.floor(ttlMs / 1000),
          path: "/",
          sameSite: "Strict",
          secure: isSecureRequest(ctx.req.raw),
        });

        return ctx.json({
          authenticated: true,
          principal: toResponsePrincipal(principal),
        });
      },
    )
    .delete(
      "/session",
      describeRoute({
        description: "Clears the cpanel session cookie. Cookie-less clients receive 204 anyway.",
        responses: {
          204: { description: "Session cookie cleared" },
        },
        summary: "Destroy admin session cookie",
        tags: ["Admin"],
      }),
      (ctx) => {
        deleteCookie(ctx, SESSION_COOKIE, {
          path: "/",
          secure: isSecureRequest(ctx.req.raw),
          sameSite: "Strict",
        });
        return ctx.body(null, 204);
      },
    );
}

export type AdminRoutesType = ReturnType<typeof createAdminRoutes>;
