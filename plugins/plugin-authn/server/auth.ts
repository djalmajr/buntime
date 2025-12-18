import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { betterAuth } from "better-auth";
import type { AuthProvider } from "./providers";
import { mergeBetterAuthConfigs } from "./providers";

export interface BetterAuthConfig {
  databasePath: string;
  providers: AuthProvider[];
  trustedOrigins?: string[];
}

// Database instance for direct queries
let db: Database | null = null;

/**
 * Get the database instance for direct queries
 */
export function getDatabase(): Database | null {
  return db;
}

export function createBetterAuth(config: BetterAuthConfig) {
  // Ensure database directory exists
  const dir = dirname(config.databasePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.databasePath, { create: true });

  // Enable WAL mode for better concurrent access
  db.run("PRAGMA journal_mode = WAL");

  // Determine base URL from trusted origins or default to localhost:8000
  const baseURL = config.trustedOrigins?.[0] || "http://localhost:8000";

  // Merge configs from all providers
  const providerConfigs = mergeBetterAuthConfigs(config.providers);

  return betterAuth({
    baseURL,
    basePath: "/auth/api/auth", // Full path where better-auth handles OAuth callbacks
    database: db,
    emailAndPassword: providerConfigs.emailAndPassword,
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin types are complex
    plugins: providerConfigs.plugins as any,
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min cache
      },
    },
    trustedOrigins: config.trustedOrigins || [],
    // Custom user fields for OAuth providers (Keycloak roles, groups, etc.)
    user: {
      additionalFields: {
        roles: {
          type: "string",
          required: false,
          input: false, // Set by OAuth provider, not user input
        },
        groups: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createBetterAuth>;
