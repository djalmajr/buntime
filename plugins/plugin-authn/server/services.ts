import type { PluginLogger } from "@buntime/shared/types";
import { type Auth, type BetterAuthConfig, createBetterAuth } from "./auth";
import type { AuthProvider, ProviderConfig, ProviderInfo } from "./providers";
import { createProviders, getProvidersInfo } from "./providers";

// Module-level state
let auth: Auth | null = null;
let providers: AuthProvider[] = [];
let logger: PluginLogger | null = null;

export interface AuthnServiceConfig {
  databasePath: string;
  providers: ProviderConfig[];
  trustedOrigins?: string[];
}

/**
 * Initialize the authentication service
 */
export function initialize(config: AuthnServiceConfig, pluginLogger: PluginLogger): Auth | null {
  logger = pluginLogger;

  if (!config.providers || config.providers.length === 0) {
    logger.warn("No providers configured - authentication will be disabled");
    return null;
  }

  // Create provider instances
  providers = createProviders(config.providers);

  const authConfig: BetterAuthConfig = {
    databasePath: config.databasePath,
    providers,
    trustedOrigins: config.trustedOrigins,
  };

  auth = createBetterAuth(authConfig);

  const providerTypes = config.providers.map((p) => p.type).join(", ");
  logger.info(`Authentication service initialized with providers: ${providerTypes}`);

  return auth;
}

/**
 * Shutdown the authentication service
 */
export function shutdown(): void {
  auth = null;
  providers = [];
  logger?.info("Authentication service shut down");
}

/**
 * Get the auth instance
 */
export function getAuth(): Auth | null {
  return auth;
}

/**
 * Get configured providers info for client
 */
export function getProviders(): ProviderInfo[] {
  return getProvidersInfo(providers);
}

/**
 * Get the logger instance
 */
export function getLogger(): PluginLogger | null {
  return logger;
}

/**
 * Identity information for X-Identity header
 */
export interface Identity {
  claims: Record<string, unknown>;
  groups: string[];
  roles: string[];
  sub: string;
}

/**
 * Get session with user identity from request headers
 * Returns Identity object for X-Identity header injection
 */
export async function getIdentityFromSession(headers: Headers): Promise<Identity | null> {
  if (!auth) {
    return null;
  }

  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      return null;
    }

    // Extract roles from user data
    const user = session.user as Record<string, unknown>;
    const roles: string[] = [];
    const groups: string[] = [];
    const claims: Record<string, unknown> = {};

    // Check for roles - can be array or JSON string (from OAuth providers like Keycloak)
    if (Array.isArray(user.roles)) {
      roles.push(...user.roles);
    } else if (typeof user.roles === "string") {
      try {
        const parsed = JSON.parse(user.roles);
        if (Array.isArray(parsed)) {
          roles.push(...parsed);
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Check for groups - can be array or JSON string
    if (Array.isArray(user.groups)) {
      groups.push(...user.groups);
    } else if (typeof user.groups === "string") {
      try {
        const parsed = JSON.parse(user.groups);
        if (Array.isArray(parsed)) {
          groups.push(...parsed);
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Copy other claims
    for (const [key, value] of Object.entries(user)) {
      if (!["id", "email", "name", "roles", "groups"].includes(key)) {
        claims[key] = value;
      }
    }

    return {
      claims,
      groups,
      roles,
      sub: session.user.id,
    };
  } catch (err) {
    logger?.error("Failed to get session", { error: String(err) });
    return null;
  }
}
