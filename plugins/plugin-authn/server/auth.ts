import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./db/schema";
import type { AuthProvider } from "./providers";
import { mergeBetterAuthConfigs } from "./providers";

export interface BetterAuthConfig {
  db: LibSQLDatabase<typeof schema>;
  providers: AuthProvider[];
  trustedOrigins?: string[];
}

export function createBetterAuth(config: BetterAuthConfig) {
  // Determine base URL from trusted origins or default to localhost:8000
  const baseURL = config.trustedOrigins?.[0] || "http://localhost:8000";

  // Merge configs from all providers
  const providerConfigs = mergeBetterAuthConfigs(config.providers);

  return betterAuth({
    baseURL,
    basePath: "/auth/api/auth", // Full path where better-auth handles OAuth callbacks
    database: drizzleAdapter(config.db, {
      provider: "sqlite", // libsql uses sqlite provider
      schema,
    }),
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
        // SCIM fields
        active: {
          type: "boolean",
          required: false,
          defaultValue: true,
          input: false,
        },
        externalId: {
          type: "string",
          required: false,
          input: false,
        },
        metadata: {
          type: "string",
          required: false,
          input: false,
        },
        // OAuth provider data
        groups: {
          type: "string",
          required: false,
          input: false,
        },
        roles: {
          type: "string",
          required: false,
          input: false, // Set by OAuth provider, not user input
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createBetterAuth>;
