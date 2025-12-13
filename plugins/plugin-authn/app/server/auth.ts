import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { betterAuth } from "better-auth";
import { genericOAuth, keycloak } from "better-auth/plugins";

export interface BetterAuthConfig {
  clientId: string;
  clientSecret: string;
  databasePath: string;
  issuer: string;
  trustedOrigins?: string[];
}

export function createBetterAuth(config: BetterAuthConfig) {
  // Ensure database directory exists
  const dir = dirname(config.databasePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(config.databasePath, { create: true });

  // Enable WAL mode for better concurrent access
  db.run("PRAGMA journal_mode = WAL");

  // Determine base URL from trusted origins or default to localhost:8000
  const baseURL = config.trustedOrigins?.[0] || "http://localhost:8000";

  return betterAuth({
    baseURL,
    basePath: "/auth/api", // Public path (proxy strips /auth for internal routing)
    database: db,
    emailAndPassword: {
      enabled: false, // Only social login via Keycloak
    },
    plugins: [
      genericOAuth({
        config: [
          keycloak({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            issuer: config.issuer,
          }),
        ],
      }),
    ],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min cache
      },
    },
    trustedOrigins: config.trustedOrigins || [],
  });
}

export type Auth = ReturnType<typeof createBetterAuth>;
