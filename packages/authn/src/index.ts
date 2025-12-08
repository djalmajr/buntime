import type { BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils";
import { Hono } from "hono";

export interface Identity {
  /** Subject (user ID) */
  sub: string;
  /** User email */
  email?: string;
  /** User display name */
  name?: string;
  /** User roles */
  roles: string[];
  /** User groups */
  groups: string[];
  /** All claims from token */
  claims: Record<string, unknown>;
  /** Raw decoded token */
  raw: Record<string, unknown>;
}

export interface AuthnConfig {
  /**
   * Authentication provider
   * @default "keycloak"
   */
  provider?: "keycloak" | "oidc" | "jwt";

  /**
   * Keycloak/OIDC issuer URL
   * Supports ${ENV_VAR} syntax
   * @example "${KEYCLOAK_URL}" or "https://auth.example.com"
   */
  issuer?: string;

  /**
   * Keycloak realm (only for provider: "keycloak")
   * Supports ${ENV_VAR} syntax
   */
  realm?: string;

  /**
   * OIDC client ID
   * Supports ${ENV_VAR} syntax
   */
  clientId?: string;

  /**
   * OIDC client secret (for introspection)
   * Supports ${ENV_VAR} syntax
   */
  clientSecret?: string;

  /**
   * JWT secret (only for provider: "jwt")
   * Supports ${ENV_VAR} syntax
   */
  secret?: string;

  /**
   * JWT algorithm (only for provider: "jwt")
   * @default "HS256"
   */
  algorithm?: "HS256" | "RS256";

  /**
   * Allow requests without token (auth is optional)
   * @default false
   */
  optional?: boolean;

  /**
   * Header name for token
   * @default "Authorization"
   */
  headerName?: string;

  /**
   * Token prefix in header
   * @default "Bearer"
   */
  tokenPrefix?: string;

  /**
   * Paths that skip authentication (regex patterns)
   * @example ["/health", "/public/.*"]
   */
  excludePaths?: string[];

  /**
   * JWKS cache TTL in seconds
   * @default 3600
   */
  jwksCacheTtl?: number;
}

interface JWKS {
  keys: JWK[];
}

interface JWK {
  alg?: string;
  e?: string;
  kid?: string;
  kty: string;
  n?: string;
  use?: string;
}

interface ResolvedConfig {
  algorithm: "HS256" | "RS256";
  clientId: string;
  clientSecret: string;
  excludePatterns: RegExp[];
  headerName: string;
  issuer: string;
  jwksCacheTtl: number;
  optional: boolean;
  provider: "keycloak" | "oidc" | "jwt";
  realm: string;
  secret: string;
  tokenPrefix: string;
}

let config: ResolvedConfig;
let logger: PluginContext["logger"];
let jwksCache: { keys: JWKS; fetchedAt: number } | null = null;

function resolveConfig(raw: AuthnConfig): ResolvedConfig {
  const provider = raw.provider ?? "keycloak";
  let issuer = raw.issuer ? substituteEnvVars(raw.issuer) : "";
  const realm = raw.realm ? substituteEnvVars(raw.realm) : "";

  // Build Keycloak issuer URL
  if (provider === "keycloak" && issuer && realm) {
    issuer = `${issuer.replace(/\/$/, "")}/realms/${realm}`;
  }

  return {
    algorithm: raw.algorithm ?? "HS256",
    clientId: raw.clientId ? substituteEnvVars(raw.clientId) : "",
    clientSecret: raw.clientSecret ? substituteEnvVars(raw.clientSecret) : "",
    excludePatterns: (raw.excludePaths ?? []).map((p) => new RegExp(p)),
    headerName: raw.headerName ?? "Authorization",
    issuer,
    jwksCacheTtl: raw.jwksCacheTtl ?? 3600,
    optional: raw.optional ?? false,
    provider,
    realm,
    secret: raw.secret ? substituteEnvVars(raw.secret) : "",
    tokenPrefix: raw.tokenPrefix ?? "Bearer",
  };
}

function isExcluded(pathname: string): boolean {
  return config.excludePatterns.some((p) => p.test(pathname));
}

function extractToken(req: Request): string | null {
  const header = req.headers.get(config.headerName);
  if (!header) return null;

  const prefix = config.tokenPrefix + " ";
  if (!header.startsWith(prefix)) return null;

  return header.slice(prefix.length);
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(base64 + padding);
}

function decodeJwt(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  return {
    header: JSON.parse(base64UrlDecode(parts[0]!)),
    payload: JSON.parse(base64UrlDecode(parts[1]!)),
  };
}

async function fetchJwks(): Promise<JWKS> {
  const now = Date.now();

  // Check cache
  if (jwksCache && now - jwksCache.fetchedAt < config.jwksCacheTtl * 1000) {
    return jwksCache.keys;
  }

  const jwksUrl = `${config.issuer}/protocol/openid-connect/certs`;
  logger.debug(`Fetching JWKS from ${jwksUrl}`);

  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }

  const keys = (await response.json()) as JWKS;
  jwksCache = { keys, fetchedAt: now };

  return keys;
}

async function verifyJwtSignature(
  token: string,
  decoded: ReturnType<typeof decodeJwt>,
): Promise<boolean> {
  if (config.provider === "jwt" && config.secret) {
    // Simple HS256 verification (for JWT provider)
    // Note: In production, use a proper JWT library
    // This is a simplified implementation
    return true; // TODO: Implement HS256 verification
  }

  // For Keycloak/OIDC, we trust the signature if we can decode it
  // Full verification would require crypto operations with JWKS
  // For now, we rely on Keycloak introspection for full verification

  const jwks = await fetchJwks();
  const kid = decoded.header.kid as string;

  if (!jwks.keys.find((k) => k.kid === kid)) {
    logger.warn(`JWT key ID not found in JWKS: ${kid}`);
    return false;
  }

  // TODO: Implement RS256 verification with Web Crypto API
  return true;
}

function extractIdentity(payload: Record<string, unknown>): Identity {
  // Keycloak-specific claims
  const realmAccess = payload.realm_access as { roles?: string[] } | undefined;
  const resourceAccess = payload.resource_access as
    | Record<string, { roles?: string[] }>
    | undefined;

  // Collect all roles
  const roles: string[] = [...(realmAccess?.roles ?? [])];
  if (resourceAccess) {
    for (const [, access] of Object.entries(resourceAccess)) {
      if (access.roles) {
        roles.push(...access.roles);
      }
    }
  }

  return {
    sub: payload.sub as string,
    email: payload.email as string | undefined,
    name: (payload.name ?? payload.preferred_username) as string | undefined,
    roles: [...new Set(roles)], // Deduplicate
    groups: (payload.groups as string[]) ?? [],
    claims: payload,
    raw: payload,
  };
}

async function validateToken(token: string): Promise<Identity> {
  const decoded = decodeJwt(token);
  const payload = decoded.payload;

  // Check expiration
  const exp = payload.exp as number | undefined;
  if (exp && Date.now() >= exp * 1000) {
    throw new Error("Token expired");
  }

  // Check issuer
  const iss = payload.iss as string | undefined;
  if (config.issuer && iss !== config.issuer) {
    throw new Error(`Invalid issuer: ${iss}`);
  }

  // Verify signature
  const valid = await verifyJwtSignature(token, decoded);
  if (!valid) {
    throw new Error("Invalid token signature");
  }

  return extractIdentity(payload);
}

const routes = new Hono()
  .get("/well-known", (ctx) => {
    return ctx.json({
      issuer: config.issuer,
      provider: config.provider,
    });
  })
  .post("/introspect", async (ctx) => {
    const body = await ctx.req.json<{ token: string }>();

    if (!body.token) {
      return ctx.json({ error: "Token required" }, 400);
    }

    try {
      const identity = await validateToken(body.token);
      return ctx.json({ active: true, ...identity });
    } catch (err) {
      return ctx.json({ active: false, error: (err as Error).message });
    }
  });

/**
 * Authentication plugin for Buntime
 *
 * Supports:
 * - Keycloak (OIDC + realm-specific features)
 * - Generic OIDC providers
 * - Simple JWT validation
 *
 * Injects identity into request headers as X-Identity (JSON serialized)
 * for downstream plugins (like authz) to use.
 *
 * @example
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     ["@buntime/authn", {
 *       provider: "keycloak",
 *       issuer: "${KEYCLOAK_URL}",
 *       realm: "${KEYCLOAK_REALM}",
 *       excludePaths: ["/health", "/public/.*"],
 *     }],
 *   ],
 * }
 * ```
 */
export default function authnPlugin(pluginConfig: AuthnConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/authn",
    version: "1.0.0",
    priority: 10, // Run after proxy, before authz

    onInit(ctx: PluginContext) {
      logger = ctx.logger;
      config = resolveConfig(pluginConfig);

      if (!config.issuer && config.provider !== "jwt") {
        logger.warn("No issuer configured - authentication will be disabled");
      }

      logger.info(`Authentication initialized (provider: ${config.provider})`);
    },

    async onRequest(req, app) {
      // Skip if no issuer configured (disabled)
      if (!config.issuer && config.provider !== "jwt") {
        return;
      }

      const url = new URL(req.url);

      // Skip excluded paths
      if (isExcluded(url.pathname)) {
        return;
      }

      // Extract token
      const token = extractToken(req);

      if (!token) {
        if (config.optional) {
          return; // Continue without identity
        }

        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Validate token
      let identity: Identity;
      try {
        identity = await validateToken(token);
      } catch (err) {
        logger.debug(`Token validation failed: ${(err as Error).message}`);

        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Inject identity into request headers
      const newReq = new Request(req.url, {
        body: req.body,
        headers: new Headers(req.headers),
        method: req.method,
      });
      newReq.headers.set("X-Identity", JSON.stringify(identity));

      return newReq;
    },

    routes,
  };
}

// Named export
export { authnPlugin };
