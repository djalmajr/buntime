import type { AdapterType, DatabaseService } from "@buntime/plugin-database";
import type { AppInfo, PluginContext, PluginImpl, PublicRoutesConfig } from "@buntime/shared/types";
import { getPublicRoutesForMethod, globArrayToRegex } from "@buntime/shared/utils/glob";
import { api } from "./server/api";

/**
 * Check if a route is public for the given worker
 */
function isPublicRoute(
  pathname: string,
  method: string,
  internalPublicRoutes: PublicRoutesConfig,
  app?: AppInfo,
): boolean {
  // 1. Check internal plugin routes (absolute paths)
  const internalRoutes = getPublicRoutesForMethod(internalPublicRoutes, method);
  if (internalRoutes.length > 0) {
    const regex = globArrayToRegex(internalRoutes);
    if (regex?.test(pathname)) return true;
  }

  // 2. Check worker's publicRoutes (relative to app basePath)
  if (app?.config?.publicRoutes && app.name) {
    const workerRoutes = getPublicRoutesForMethod(app.config.publicRoutes, method);
    if (workerRoutes.length > 0) {
      const basePath = `/${app.name}`;
      const absoluteRoutes = workerRoutes.map((route) => `${basePath}${route}`);
      const regex = globArrayToRegex(absoluteRoutes);
      if (regex?.test(pathname)) return true;
    }
  }

  return false;
}

import type {
  Auth0ProviderConfig,
  EmailPasswordProviderConfig,
  GenericOIDCProviderConfig,
  GoogleProviderConfig,
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
    })
  | (Omit<GoogleProviderConfig, "clientId" | "clientSecret"> & {
      clientId: string;
      clientSecret: string;
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
   * Base path for this plugin (comes from manifest)
   * @example "/auth"
   */
  base?: string;

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
   * @default []
   */
  providers?: ProviderConfigInput[];

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
 * Process provider config (values come directly from ConfigMap or manifest)
 */
function processProviderConfig(input: ProviderConfigInput): ProviderConfig {
  return input as ProviderConfig;
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
 * @example Email/Password only (development)
 * ```jsonc
 * // plugins/plugin-database/manifest.yaml
 * {
 *   "enabled": true,
 *   "adapters": [{ "type": "libsql", "default": true }]
 * }
 * ```
 *
 * ```jsonc
 * // plugins/plugin-authn/manifest.yaml
 * {
 *   "enabled": true,
 *   "providers": [
 *     { "type": "email-password", "allowSignUp": true }
 *   ]
 * }
 * ```
 *
 * @example Keycloak with SCIM and multi-tenancy
 * ```jsonc
 * // plugins/plugin-database/manifest.yaml
 * {
 *   "enabled": true,
 *   "adapters": [{ "type": "libsql", "default": true }],
 *   "tenancy": { "enabled": true, "header": "x-tenant-id" }
 * }
 * ```
 *
 * ```jsonc
 * // plugins/plugin-authn/manifest.yaml
 * {
 *   "enabled": true,
 *   "providers": [
 *     {
 *       "type": "keycloak",
 *       "issuer": "${KEYCLOAK_URL}",
 *       "realm": "${KEYCLOAK_REALM}",
 *       "clientId": "${KEYCLOAK_CLIENT_ID}",
 *       "clientSecret": "${KEYCLOAK_CLIENT_SECRET}"
 *     }
 *   ],
 *   "scim": { "enabled": true }
 * }
 * ```
 *
 * @example With API keys for CI/CD
 * ```jsonc
 * // plugins/plugin-authn/manifest.yaml
 * {
 *   "enabled": true,
 *   "providers": [{ "type": "email-password" }],
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
export default function authnPlugin(config: AuthnConfig = {} as AuthnConfig): PluginImpl {
  // Process provider configs (values come from ConfigMap or manifest)
  const providers = (config.providers ?? []).map(processProviderConfig);

  // API keys come directly from config (values from ConfigMap or manifest)
  const apiKeys = config.apiKeys;

  // Base path from config (set by loader from manifest)
  const basePath = config.base ?? "/auth";

  // Internal public routes for this plugin (absolute paths)
  const internalPublicRoutes: PublicRoutesConfig = {
    ALL: [`${basePath}/api`, `${basePath}/api/**`],
    GET: [`${basePath}/login`, `${basePath}/login/**`],
  };

  return {
    // API routes run on main thread
    routes: api,

    async onInit(ctx: PluginContext) {
      // Get database service from plugin-database
      const database = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
      if (!database) {
        throw new Error(
          "@buntime/plugin-authn requires @buntime/plugin-database. " +
            "Add it to your manifest.yaml plugins before plugin-authn.",
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

    async onRequest(req, app) {
      const url = new URL(req.url);

      // Skip auth routes (handled by routes/worker)
      if (url.pathname.startsWith(`${basePath}/`)) {
        return;
      }

      // Check if this route is public (internal plugin routes OR worker's publicRoutes)
      if (isPublicRoute(url.pathname, req.method, internalPublicRoutes, app)) {
        return; // Skip authentication for public routes
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
  GoogleProviderConfig,
  KeycloakProviderConfig,
  OktaProviderConfig,
  ProviderConfig,
  ProviderInfo,
} from "./server/providers";
