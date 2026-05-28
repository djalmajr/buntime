/**
 * Admin authentication for the tenant CRUD routes. A write must carry a valid
 * Bearer JWT from the **admin realm** (verified against its JWKS). The verifier
 * is injectable so tests can stub it without a live Keycloak.
 */

import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

export type AdminVerifier = (token: string) => Promise<JWTPayload>;

/**
 * Build a verifier that checks tokens against `${keycloakUrl}/realms/${realm}`
 * (issuer) using the realm JWKS. Remote JWKS is cached by `jose`.
 */
export function keycloakVerifier(keycloakUrl: string, realm: string): AdminVerifier {
  const issuer = `${keycloakUrl.replace(/\/$/, "")}/realms/${realm}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer });
    return payload;
  };
}

/**
 * Hono middleware gating the tenant CRUD routes. Accepts either:
 *  - `X-API-Key: <rootKey>` — the runtime root key (forwarded as RUNTIME_ROOT_KEY),
 *    a bootstrap/ops escape hatch that authenticates as a synthetic `root`. This
 *    is how the very first (admin) tenant is provisioned before its realm exists.
 *  - `Authorization: Bearer <jwt>` — a valid admin-realm token (verified by JWKS).
 */
export function requireAdmin(verify: AdminVerifier, rootKey?: string): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = c.req.header("X-API-Key");
    if (rootKey && apiKey === rootKey) {
      c.set("identity", { sub: "root", root: true });
      await next();
      return;
    }
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      c.set("identity", await verify(token));
    } catch {
      return c.json({ error: "Invalid token" }, 401);
    }
    await next();
  };
}
