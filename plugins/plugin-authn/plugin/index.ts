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

// Path to plugin root (contains package.json)
const pluginDir = new URL("..", import.meta.url).pathname;

/**
 * Create plugin definition with apps configuration
 */
export function createPluginDefinition(config: AuthnConfig): BuntimePlugin {
  // Resolve config with env vars
  const issuer = config.issuer ? substituteEnvVars(config.issuer) : "";
  const realm = config.realm ? substituteEnvVars(config.realm) : "";
  const clientId = config.clientId ? substituteEnvVars(config.clientId) : "";
  const clientSecret = config.clientSecret ? substituteEnvVars(config.clientSecret) : "";

  // Build full issuer URL for Keycloak
  const fullIssuer = issuer && realm ? `${issuer.replace(/\/$/, "")}/realms/${realm}` : issuer;

  // Public routes that skip onRequest hooks
  const publicRoutes: PublicRoutesConfig = {
    ALL: ["/auth/api", "/auth/api/**"],
    GET: ["/auth/login", "/auth/login/**"],
  };

  return {
    name: "@buntime/plugin-authn",
    version: "1.0.0",
    optionalDependencies: ["@buntime/plugin-proxy"],

    // Single app serving both React SPA and API
    apps: [
      {
        dir: pluginDir,
        routes: ["/auth/login", "/auth/login/**", "/auth/api", "/auth/api/**"],
        config: {
          entrypoint: "app/index.ts",
          idleTimeout: config.idleTimeout ?? 300,
          // Pass auth config to worker via environment
          env: {
            AUTHN_CLIENT_ID: clientId,
            AUTHN_CLIENT_SECRET: clientSecret,
            AUTHN_DATABASE_PATH: config.databasePath ?? "./data/auth.db",
            AUTHN_ISSUER: fullIssuer,
            AUTHN_TRUSTED_ORIGINS: (config.trustedOrigins ?? []).join(","),
          },
        },
      },
    ],

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
      if (url.pathname.startsWith("/auth/")) {
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
      const loginUrl = new URL(config.loginPath ?? "/auth/login", url.origin);
      loginUrl.searchParams.set("redirect", url.pathname + url.search);
      return Response.redirect(loginUrl.toString());
    },
  };
}
