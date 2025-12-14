import type { BuntimePlugin, PluginContext, PublicRoutesConfig } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils/zod-helpers";

export interface AuthnConfig {
  /**
   * Keycloak/OIDC issuer URL
   * Supports ${ENV_VAR} syntax
   */
  issuer?: string;

  /**
   * Keycloak realm
   * Supports ${ENV_VAR} syntax
   */
  realm?: string;

  /**
   * OIDC client ID
   * Supports ${ENV_VAR} syntax
   */
  clientId?: string;

  /**
   * OIDC client secret
   * Supports ${ENV_VAR} syntax
   */
  clientSecret?: string;

  /**
   * SQLite database path for sessions
   * @default "./data/auth.db"
   */
  databasePath?: string;

  /**
   * Trusted origins for CORS
   */
  trustedOrigins?: string[];

  /**
   * Login redirect path
   * @default "/login"
   */
  loginPath?: string;

  /**
   * Worker idle timeout in seconds
   * @default 300
   */
  idleTimeout?: number;
}

/**
 * Authentication plugin for Buntime
 *
 * Uses better-auth with Keycloak for session-based authentication.
 * Serves a login page at /login and handles OAuth at /api/auth/*.
 *
 * @example
 * ```typescript
 * // buntime.jsonc
 * {
 *   "plugins": [
 *     ["@buntime/plugin-authn", {
 *       "issuer": "${KEYCLOAK_URL}",
 *       "realm": "${KEYCLOAK_REALM}",
 *       "clientId": "${KEYCLOAK_CLIENT_ID}",
 *       "clientSecret": "${KEYCLOAK_CLIENT_SECRET}"
 *     }]
 *   ]
 * }
 * ```
 */
export default function authnPlugin(config: AuthnConfig = {}): BuntimePlugin {
  return createPluginDefinition(config);
}

/**
 * Create plugin definition
 */
function createPluginDefinition(config: AuthnConfig): BuntimePlugin {
  // Resolve config with env vars
  const issuer = config.issuer ? substituteEnvVars(config.issuer) : "";
  const realm = config.realm ? substituteEnvVars(config.realm) : "";
  const clientId = config.clientId ? substituteEnvVars(config.clientId) : "";
  const clientSecret = config.clientSecret ? substituteEnvVars(config.clientSecret) : "";

  // Build full issuer URL for Keycloak
  const fullIssuer = issuer && realm ? `${issuer.replace(/\/$/, "")}/realms/${realm}` : issuer;

  // Public routes that skip onRequest hooks
  const publicRoutes: PublicRoutesConfig = {
    ALL: ["/p/auth/api", "/p/auth/api/**"],
    GET: ["/p/auth/login", "/p/auth/login/**"],
  };

  // Store config in environment for worker access
  if (clientId) process.env.AUTHN_CLIENT_ID = clientId;
  if (clientSecret) process.env.AUTHN_CLIENT_SECRET = clientSecret;
  if (fullIssuer) process.env.AUTHN_ISSUER = fullIssuer;
  process.env.AUTHN_DATABASE_PATH = config.databasePath ?? "./data/auth.db";
  if (config.trustedOrigins?.length) {
    process.env.AUTHN_TRUSTED_ORIGINS = config.trustedOrigins.join(",");
  }

  return {
    name: "@buntime/plugin-authn",
    optionalDependencies: ["@buntime/plugin-proxy"],

    // Custom base path (default would be /p/authn)
    base: "/p/auth",

    publicRoutes,

    onInit(ctx: PluginContext) {
      if (!fullIssuer) {
        ctx.logger.warn("No issuer configured - authentication will be disabled");
        return;
      }
      ctx.logger.info("Authentication plugin initialized");
    },

    async onRequest(req) {
      const url = new URL(req.url);

      // Skip public routes (handled by registry)
      // Skip auth routes (handled by proxy/worker)
      if (url.pathname.startsWith("/p/auth/")) {
        return;
      }

      // Check for session cookie
      const sessionCookie = req.headers.get("cookie")?.includes("better-auth.session_token");
      if (sessionCookie) {
        return; // Has session, continue
      }

      // No session - check if API request
      const isApiRequest = req.headers.get("accept")?.includes("application/json");
      if (isApiRequest) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Redirect to login
      const loginUrl = new URL(config.loginPath ?? "/p/auth/login", url.origin);
      loginUrl.searchParams.set("redirect", url.pathname + url.search);
      return Response.redirect(loginUrl.toString());
    },
  };
}

// Named exports
export { authnPlugin };
