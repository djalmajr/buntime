import type { BuntimePlugin, PluginContext, PublicRoutesConfig } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils/zod-helpers";
import { api } from "./server/api";
import type {
  Auth0ProviderConfig,
  EmailPasswordProviderConfig,
  GenericOIDCProviderConfig,
  KeycloakProviderConfig,
  OktaProviderConfig,
  ProviderConfig,
} from "./server/providers";
import {
  type AuthnServiceConfig,
  getIdentityFromSession,
  initialize,
  shutdown,
} from "./server/services";

/**
 * Provider config with env var substitution applied
 */
type ProviderConfigInput =
  | EmailPasswordProviderConfig
  | (Omit<KeycloakProviderConfig, "clientId" | "clientSecret" | "issuer" | "realm"> & {
      clientId: string;
      clientSecret: string;
      issuer: string;
      realm: string;
    })
  | (Omit<Auth0ProviderConfig, "clientId" | "clientSecret" | "domain"> & {
      clientId: string;
      clientSecret: string;
      domain: string;
    })
  | (Omit<OktaProviderConfig, "clientId" | "clientSecret" | "domain"> & {
      clientId: string;
      clientSecret: string;
      domain: string;
    })
  | (Omit<GenericOIDCProviderConfig, "clientId" | "clientSecret" | "issuer"> & {
      clientId: string;
      clientSecret: string;
      issuer: string;
    });

export interface AuthnConfig {
  /**
   * SQLite database path for sessions
   * @default "./data/auth.db"
   */
  databasePath?: string;

  /**
   * Login redirect path
   * @default "/auth/login"
   */
  loginPath?: string;

  /**
   * Authentication providers
   * Supports multiple providers simultaneously
   */
  providers: ProviderConfigInput[];

  /**
   * Trusted origins for CORS
   */
  trustedOrigins?: string[];
}

/**
 * Substitute env vars in provider config
 */
function processProviderConfig(input: ProviderConfigInput): ProviderConfig {
  if (input.type === "email-password") {
    return input;
  }

  const result = { ...input };

  // Process string fields that may contain env vars
  for (const key of ["clientId", "clientSecret", "issuer", "realm", "domain"] as const) {
    if (key in result && typeof (result as Record<string, unknown>)[key] === "string") {
      (result as Record<string, unknown>)[key] = substituteEnvVars(
        (result as Record<string, unknown>)[key] as string,
      );
    }
  }

  return result as ProviderConfig;
}

/**
 * Authentication plugin for Buntime
 *
 * Provides session-based authentication with:
 * - Multiple provider support (Email/Password, Keycloak, Auth0, Okta, Generic OIDC)
 * - Automatic session management
 * - Login page with dynamic provider selection
 * - Request interception for protected routes
 *
 * @example
 * ```jsonc
 * // buntime.jsonc - Email/Password only (development)
 * {
 *   "plugins": [
 *     ["@buntime/plugin-authn", {
 *       "providers": [
 *         { "type": "email-password", "allowSignUp": true }
 *       ]
 *     }]
 *   ]
 * }
 * ```
 *
 * @example
 * ```jsonc
 * // buntime.jsonc - Keycloak only (production)
 * {
 *   "plugins": [
 *     ["@buntime/plugin-authn", {
 *       "providers": [
 *         {
 *           "type": "keycloak",
 *           "issuer": "${KEYCLOAK_URL}",
 *           "realm": "${KEYCLOAK_REALM}",
 *           "clientId": "${KEYCLOAK_CLIENT_ID}",
 *           "clientSecret": "${KEYCLOAK_CLIENT_SECRET}"
 *         }
 *       ]
 *     }]
 *   ]
 * }
 * ```
 *
 * @example
 * ```jsonc
 * // buntime.jsonc - Multiple providers
 * {
 *   "plugins": [
 *     ["@buntime/plugin-authn", {
 *       "providers": [
 *         { "type": "email-password" },
 *         { "type": "keycloak", "displayName": "SSO", ... }
 *       ]
 *     }]
 *   ]
 * }
 * ```
 */
export default function authnPlugin(config: AuthnConfig): BuntimePlugin {
  const databasePath = config.databasePath ?? "./data/auth.db";

  // Process provider configs (substitute env vars)
  const providers = config.providers.map(processProviderConfig);

  // Public routes that skip onRequest hooks
  const publicRoutes: PublicRoutesConfig = {
    ALL: ["/auth/api", "/auth/api/**"],
    GET: ["/auth/login", "/auth/login/**"],
  };

  return {
    name: "@buntime/plugin-authn",
    optionalDependencies: ["@buntime/plugin-proxy"],

    // Custom base path (default would be /authn)
    base: "/auth",

    // API routes run on main thread
    routes: api,

    publicRoutes,

    onInit(ctx: PluginContext) {
      const serviceConfig: AuthnServiceConfig = {
        databasePath,
        providers,
        trustedOrigins: config.trustedOrigins,
      };

      initialize(serviceConfig, ctx.logger);
    },

    onShutdown() {
      shutdown();
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
        // Get identity from session and inject X-Identity header
        const identity = await getIdentityFromSession(req.headers);
        if (identity) {
          const newHeaders = new Headers(req.headers);
          newHeaders.set("X-Identity", JSON.stringify(identity));
          return new Request(req.url, {
            body: req.body,
            duplex: "half",
            headers: newHeaders,
            method: req.method,
          } as RequestInit);
        }
        return; // Has session but couldn't get identity, continue anyway
      }

      // No session - check if API request
      const isApiRequest = req.headers.get("accept")?.includes("application/json");
      if (isApiRequest) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        });
      }

      // Redirect to login
      const loginUrl = new URL(config.loginPath ?? "/auth/login", url.origin);
      loginUrl.searchParams.set("redirect", url.pathname + url.search);
      return Response.redirect(loginUrl.toString());
    },
  };
}

// Named exports
export { authnPlugin };

// Export type for API client
export type { ApiType as AuthnRoutesType } from "./server/api";
// Export types
export type {
  Auth0ProviderConfig,
  AuthProviderType,
  EmailPasswordProviderConfig,
  GenericOIDCProviderConfig,
  KeycloakProviderConfig,
  OktaProviderConfig,
  ProviderConfig,
  ProviderInfo,
} from "./server/providers";
