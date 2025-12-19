import type { AdapterType, DatabaseService } from "@buntime/plugin-database";
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

/**
 * API Key configuration for machine-to-machine authentication
 */
export interface ApiKeyConfig {
  /**
   * The API key value. Supports ${ENV_VAR} substitution.
   */
  key: string;

  /**
   * Display name for this API key (used in X-Identity)
   */
  name: string;

  /**
   * Roles to assign to this API key
   * @default ["api-client"]
   */
  roles?: string[];
}

export interface AuthnConfig {
  /**
   * API keys for machine-to-machine authentication (CI/CD, external services)
   * Requests with valid X-API-Key header will be authenticated without session
   *
   * @example
   * ```jsonc
   * {
   *   "apiKeys": [
   *     {
   *       "key": "${GITLAB_DEPLOY_KEY}",
   *       "name": "GitLab CI/CD",
   *       "roles": ["deployer"]
   *     }
   *   ]
   * }
   * ```
   */
  apiKeys?: ApiKeyConfig[];

  /**
   * Database adapter type to use
   * Uses default adapter from plugin-database if not specified
   */
  database?: AdapterType;

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
   * SCIM 2.0 configuration
   */
  scim?: {
    /** Enable SCIM 2.0 endpoints (default: false) */
    enabled?: boolean;
    /** Maximum results per page (default: 100) */
    maxResults?: number;
    /** Enable bulk operations (default: true) */
    bulkEnabled?: boolean;
    /** Maximum operations per bulk request (default: 1000) */
    maxBulkOperations?: number;
  };

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
 * - SCIM 2.0 support for user provisioning
 *
 * @example
 * ```jsonc
 * // buntime.jsonc - Email/Password only (development)
 * {
 *   "plugins": [
 *     ["@buntime/plugin-database", {
 *       "adapters": [{ "type": "libsql", "default": true }]
 *     }],
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
 * // buntime.jsonc - Keycloak with SCIM
 * {
 *   "plugins": [
 *     ["@buntime/plugin-database", {
 *       "adapters": [{ "type": "libsql", "default": true }],
 *       "tenancy": { "enabled": true, "header": "X-Tenant-ID" }
 *     }],
 *     ["@buntime/plugin-authn", {
 *       "providers": [
 *         {
 *           "type": "keycloak",
 *           "issuer": "${KEYCLOAK_URL}",
 *           "realm": "${KEYCLOAK_REALM}",
 *           "clientId": "${KEYCLOAK_CLIENT_ID}",
 *           "clientSecret": "${KEYCLOAK_CLIENT_SECRET}"
 *         }
 *       ],
 *       "scim": { "enabled": true }
 *     }]
 *   ]
 * }
 * ```
 *
 * @example
 * ```jsonc
 * // buntime.jsonc - With API keys for CI/CD
 * {
 *   "plugins": [
 *     ["@buntime/plugin-authn", {
 *       "providers": [{ "type": "email-password" }],
 *       "apiKeys": [
 *         {
 *           "key": "${GITLAB_DEPLOY_KEY}",
 *           "name": "GitLab CI/CD",
 *           "roles": ["deployer"]
 *         }
 *       ]
 *     }]
 *   ]
 * }
 * ```
 */
export default function authnPlugin(config: AuthnConfig): BuntimePlugin {
  // Process provider configs (substitute env vars)
  const providers = config.providers.map(processProviderConfig);

  // Process API keys (substitute env vars in key field)
  const apiKeys = config.apiKeys?.map((ak) => ({
    ...ak,
    key: substituteEnvVars(ak.key),
  }));

  // Custom base path (default would be /authn)
  const basePath = "/auth";

  // Public routes that skip onRequest hooks
  const publicRoutes: PublicRoutesConfig = {
    ALL: [`${basePath}/api`, `${basePath}/api/**`],
    GET: [`${basePath}/login`, `${basePath}/login/**`],
  };

  return {
    name: "@buntime/plugin-authn",
    dependencies: ["@buntime/plugin-database"],
    optionalDependencies: ["@buntime/plugin-proxy"],

    base: basePath,

    // API routes run on main thread
    routes: api,

    publicRoutes,

    async onInit(ctx: PluginContext) {
      // Get database service from plugin-database
      const database = ctx.getService<DatabaseService>("database");
      if (!database) {
        throw new Error(
          "@buntime/plugin-authn requires @buntime/plugin-database. " +
            "Add it to your buntime.jsonc plugins before plugin-authn.",
        );
      }

      const serviceConfig: AuthnServiceConfig = {
        basePath,
        database: config.database,
        providers,
        scim: config.scim,
        trustedOrigins: config.trustedOrigins,
      };

      await initialize(database, serviceConfig, ctx.logger);
    },

    onShutdown() {
      shutdown();
    },

    async onRequest(req) {
      const url = new URL(req.url);

      // Skip public routes (handled by registry)
      // Skip auth routes (handled by proxy/worker)
      if (url.pathname.startsWith(`${basePath}/`)) {
        return;
      }

      // 1. Check for API Key (machine-to-machine auth, e.g., CI/CD)
      const apiKeyHeader = req.headers.get("X-API-Key");
      if (apiKeyHeader && apiKeys) {
        const keyConfig = apiKeys.find((k) => k.key === apiKeyHeader);
        if (keyConfig) {
          const newHeaders = new Headers(req.headers);
          newHeaders.set(
            "X-Identity",
            JSON.stringify({
              id: `apikey:${keyConfig.name}`,
              name: keyConfig.name,
              roles: keyConfig.roles ?? ["api-client"],
            }),
          );
          return new Request(req.url, {
            body: req.body,
            duplex: "half",
            headers: newHeaders,
            method: req.method,
          } as RequestInit);
        }
        // Invalid API key - return 401 immediately
        return new Response(JSON.stringify({ error: "Invalid API key" }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        });
      }

      // 2. Check for session cookie
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
