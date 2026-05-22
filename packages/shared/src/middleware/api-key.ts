/**
 * @module
 * Reusable Hono middleware that authenticates a request with the runtime's
 * `ApiKeyStore` (`@buntime/shared/api-keys`). Plugins import it when they
 * need to gate routes on their own (most don't — the runtime's request
 * pipeline already validates the key at `apps/runtime/src/app.ts` and
 * bypasses every plugin `onRequest` hook when a valid credential is
 * present).
 *
 * The middleware:
 *
 * 1. Extracts the key from, in order: `X-API-Key` header, `Authorization:
 *    Bearer` header, or the `buntime_api_key` HttpOnly cookie (issued by
 *    `POST /api/admin/session` for browser SPAs).
 * 2. Optionally matches a runtime root key, if provided in `opts.rootKey`.
 * 3. Otherwise verifies against the supplied `ApiKeyStore`.
 * 4. Enforces a role allowlist (`opts.requireRole`, default
 *    `["admin", "editor"]`).
 * 5. On success, sets the principal in `c.set("principal", principal)` for
 *    the downstream handler to read.
 * 6. On failure, returns `401` (missing/invalid key) or `403` (insufficient
 *    role/permission) with a consistent JSON body.
 *
 * Granularity beyond role lives in the consumer plugin: read the principal
 * from `c.get("principal")` and check permissions/keyPrefix/name as needed.
 *
 * @example
 * ```ts
 * import { Hono } from "hono";
 * import { createApiKeyMiddleware } from "@buntime/shared/middleware/api-key";
 *
 * export const api = new Hono()
 *   .use("*", createApiKeyMiddleware({ store: ctx.apiKeys, rootKey: ctx.config.apiKey }))
 *   .get("/rules", (c) => c.json(rules));
 * ```
 */

import type { MiddlewareHandler } from "hono";
import type { ApiKeyPrincipal, ApiKeyStore, KeyRole, Permission } from "../api-keys";

export interface ApiKeyMiddlewareOptions {
  /** Optional root key (runtime-level). Bypasses store lookup if matched. */
  rootKey?: string;
  /** Required permission (in addition to role). If set, principal must have it. */
  requirePermission?: Permission;
  /**
   * Roles allowed to access this endpoint.
   * @default ["admin", "editor"]
   */
  requireRole?: KeyRole[];
  /** Key store to verify non-root keys against. Required unless rootKey is the only auth. */
  store?: ApiKeyStore;
}

/**
 * Hono variables published by this middleware. Consumer plugins can extend
 * their Hono type with `Hono<{ Variables: ApiKeyVariables }>` to get
 * a typed `c.get("principal")`.
 */
export interface ApiKeyVariables {
  principal: ApiKeyPrincipal;
}

/** Cookie name used by the cpanel session (issued by `POST /api/admin/session`). */
export const API_KEY_COOKIE_NAME = "buntime_api_key";

/**
 * Parse a `Cookie` header value into a name → value map. Does NOT decode the
 * value: callers that need percent-decoding must apply `decodeURIComponent`.
 * Returns an empty map for missing/malformed input.
 */
function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const segment of header.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name && value && !(name in out)) out[name] = value;
  }
  return out;
}

/**
 * Extract a runtime API key from a request.
 *
 * Sources, in order of preference:
 * 1. `X-API-Key` header — preferred for programmatic clients and SPAs.
 * 2. `Authorization: Bearer <key>` — standard for HTTP clients/CLIs.
 * 3. `buntime_api_key` cookie — issued by `POST /api/admin/session` for
 *    browser SPAs (HttpOnly, SameSite=Strict). Travels automatically on
 *    same-origin requests including iframes that cannot inject headers.
 *
 * Note: the legacy `?_key=` query-string fallback has been removed — it
 * leaked credentials into URLs, access logs, and the Referer header.
 */
export function extractApiKey(req: Request): string | undefined {
  const headerKey = req.headers.get("x-api-key")?.trim();
  if (headerKey) return headerKey;

  const authorization = req.headers.get("authorization")?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();

  const cookies = parseCookieHeader(req.headers.get("cookie"));
  const cookieKey = cookies[API_KEY_COOKIE_NAME]?.trim();
  if (cookieKey) return cookieKey;

  return undefined;
}

/** Build a synthetic root principal (full access, id 0). */
function rootPrincipal(): ApiKeyPrincipal {
  return {
    createdAt: 0,
    id: 0,
    isRoot: true,
    keyPrefix: "root",
    name: "root",
    permissions: [],
    role: "admin",
  };
}

function unauthorized(): Response {
  return Response.json(
    { code: "AUTH_REQUIRED", error: "Missing or invalid API key" },
    { status: 401 },
  );
}

function forbidden(reason: string): Response {
  return Response.json({ code: "PERMISSION_DENIED", error: reason }, { status: 403 });
}

/**
 * Create the middleware. Curried for ergonomic use with `.use("*", ...)`.
 */
export function createApiKeyMiddleware(opts: ApiKeyMiddlewareOptions = {}): MiddlewareHandler {
  const allowedRoles: KeyRole[] = opts.requireRole ?? ["admin", "editor"];

  return async (c, next) => {
    const supplied = extractApiKey(c.req.raw);
    if (!supplied) return unauthorized();

    let principal: ApiKeyPrincipal | null = null;

    if (opts.rootKey && supplied === opts.rootKey) {
      principal = rootPrincipal();
    } else if (opts.store) {
      principal = await opts.store.verify(supplied);
    }

    if (!principal) return unauthorized();

    // isRoot bypasses both role and permission checks.
    if (!principal.isRoot) {
      if (!allowedRoles.includes(principal.role)) {
        return forbidden(
          `Role '${principal.role}' is not allowed; need one of: ${allowedRoles.join(", ")}`,
        );
      }
      if (opts.requirePermission && !principal.permissions.includes(opts.requirePermission)) {
        // Admin role gets all permissions implicitly (matches hasPermission contract).
        if (principal.role !== "admin") {
          return forbidden(`Missing permission: ${opts.requirePermission}`);
        }
      }
    }

    c.set("principal", principal);
    await next();
  };
}
