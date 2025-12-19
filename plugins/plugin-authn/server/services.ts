import type { AdapterType, DatabaseAdapter, DatabaseService } from "@buntime/plugin-database";
import type { PluginLogger } from "@buntime/shared/types";
import type { Client } from "@libsql/client/http";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { drizzle } from "drizzle-orm/libsql/http";
import { mountScimRoutes } from "./api";
import { type Auth, type BetterAuthConfig, createBetterAuth } from "./auth";
import * as schema from "./db/schema";
import type { AuthProvider, ProviderConfig, ProviderInfo } from "./providers";
import { createProviders, getProvidersInfo } from "./providers";
import { initializeSchema } from "./schema";

/**
 * OAuth account record from database
 */
export interface OAuthAccountRecord {
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  accountId: string;
  id: string;
  idToken: string | null;
  providerId: string;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
  scope: string | null;
  userId: string;
}

// Module-level state
let auth: Auth | null = null;
let providers: AuthProvider[] = [];
let logger: PluginLogger | null = null;
let dbAdapter: DatabaseAdapter | null = null;
let dbService: DatabaseService | null = null;
let db: LibSQLDatabase<typeof schema> | null = null;
let adapterType: AdapterType | undefined;
let basePath = "/auth";

export interface AuthnServiceConfig {
  /**
   * Base path for auth routes (e.g., "/auth")
   */
  basePath?: string;

  /**
   * Database adapter type to use (uses default if not specified)
   */
  database?: AdapterType;

  /**
   * Authentication providers
   */
  providers: ProviderConfig[];

  /**
   * SCIM configuration
   */
  scim?: {
    /** Enable SCIM 2.0 endpoints */
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
 * Initialize the authentication service
 */
export async function initialize(
  database: DatabaseService,
  config: AuthnServiceConfig,
  pluginLogger: PluginLogger,
): Promise<Auth | null> {
  logger = pluginLogger;
  dbService = database;
  adapterType = config.database;
  basePath = config.basePath || "/auth";

  if (!config.providers || config.providers.length === 0) {
    logger.warn("No providers configured - authentication will be disabled");
    return null;
  }

  // Get database adapter (root adapter, multi-tenancy handled at request level)
  dbAdapter = database.getRootAdapter(config.database);

  // Get raw libsql client and create Drizzle instance
  const rawClient = dbAdapter.getRawClient() as Client;
  db = drizzle({ client: rawClient, schema });

  // Initialize schema (create tables if not exist)
  // Using raw SQL for table creation as drizzle-kit would be the proper way
  await initializeSchema(async (sql) => {
    await dbAdapter!.execute(sql, []);
  });

  logger.debug("Database schema initialized");

  // Create provider instances
  providers = createProviders(config.providers);

  const authConfig: BetterAuthConfig = {
    db,
    providers,
    trustedOrigins: config.trustedOrigins,
  };

  auth = createBetterAuth(authConfig);

  const providerTypes = config.providers.map((p) => p.type).join(", ");
  const dbType = config.database ?? database.getDefaultType();
  logger.info(
    `Authentication service initialized (providers: ${providerTypes}, database: ${dbType}, orm: drizzle)`,
  );

  // Mount SCIM routes if enabled
  if (config.scim?.enabled) {
    // Determine base URL from trusted origins
    const baseUrl = config.trustedOrigins?.[0] ?? "http://localhost:8000";

    mountScimRoutes({
      adapter: dbAdapter,
      baseUrl,
      bulkEnabled: config.scim.bulkEnabled ?? true,
      enabled: true,
      logger,
      maxBulkOperations: config.scim.maxBulkOperations ?? 1000,
      maxResults: config.scim.maxResults ?? 100,
    });
  }

  return auth;
}

/**
 * Shutdown the authentication service
 */
export function shutdown(): void {
  auth = null;
  providers = [];
  dbAdapter = null;
  dbService = null;
  db = null;
  logger?.info("Authentication service shut down");
}

/**
 * Get the auth instance
 */
export function getAuth(): Auth | null {
  return auth;
}

/**
 * Get the database adapter
 */
export function getDatabaseAdapter(): DatabaseAdapter | null {
  return dbAdapter;
}

/**
 * Get the Drizzle database instance
 */
export function getDrizzle(): LibSQLDatabase<typeof schema> | null {
  return db;
}

/**
 * Get the database service
 */
export function getDatabaseService(): DatabaseService | null {
  return dbService;
}

/**
 * Get configured adapter type
 */
export function getAdapterType(): AdapterType | undefined {
  return adapterType;
}

/**
 * Get configured providers info for client
 */
export function getProviders(): ProviderInfo[] {
  return getProvidersInfo(providers);
}

/**
 * Get provider by ID (e.g., "keycloak", "auth0")
 */
export function getProviderById(providerId: string): AuthProvider | null {
  return providers.find((p) => p.getProviderInfo().providerId === providerId) ?? null;
}

/**
 * Get the logger instance
 */
export function getLogger(): PluginLogger | null {
  return logger;
}

/**
 * Get the base path for auth routes (e.g., "/auth")
 */
export function getBasePath(): string {
  return basePath;
}

/**
 * Get OAuth accounts with tokens for a user (async database query)
 * This is needed because better-auth's listUserAccounts doesn't return OAuth tokens
 */
export async function getOAuthAccountsForUser(userId: string): Promise<OAuthAccountRecord[]> {
  if (!dbAdapter) {
    return [];
  }

  try {
    const results = await dbAdapter.execute<OAuthAccountRecord>(
      `SELECT id, accountId, providerId, userId, accessToken, refreshToken, idToken,
              accessTokenExpiresAt, refreshTokenExpiresAt, scope
       FROM account
       WHERE userId = ? AND providerId != 'credential'`,
      [userId],
    );
    return results;
  } catch (err) {
    logger?.error("Failed to get OAuth accounts", { error: String(err), userId });
    return [];
  }
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
