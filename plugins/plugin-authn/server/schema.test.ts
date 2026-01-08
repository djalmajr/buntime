/**
 * Tests for plugin-authn database schema
 *
 * Tests:
 * - SQL table definitions
 * - Index definitions
 * - Schema initialization
 */

import { describe, expect, it, mock } from "bun:test";
import {
  ACCOUNT_TABLE,
  ALL_TABLES,
  INDEXES,
  initializeSchema,
  SCIM_GROUP_MEMBER_TABLE,
  SCIM_GROUP_TABLE,
  SCIM_TOKEN_TABLE,
  SESSION_TABLE,
  USER_TABLE,
  VERIFICATION_TABLE,
} from "./schema";

describe("schema", () => {
  describe("USER_TABLE", () => {
    it("should define user table with required columns", () => {
      expect(USER_TABLE).toContain("CREATE TABLE IF NOT EXISTS user");
      expect(USER_TABLE).toContain("id TEXT PRIMARY KEY");
      expect(USER_TABLE).toContain("name TEXT NOT NULL");
      expect(USER_TABLE).toContain("email TEXT NOT NULL UNIQUE");
      expect(USER_TABLE).toContain("emailVerified INTEGER NOT NULL DEFAULT 0");
      expect(USER_TABLE).toContain("image TEXT");
      expect(USER_TABLE).toContain("createdAt TEXT NOT NULL");
      expect(USER_TABLE).toContain("updatedAt TEXT NOT NULL");
    });

    it("should include SCIM extension columns", () => {
      expect(USER_TABLE).toContain("externalId TEXT");
      expect(USER_TABLE).toContain("active INTEGER NOT NULL DEFAULT 1");
      expect(USER_TABLE).toContain("metadata TEXT");
    });

    it("should include OAuth provider data columns", () => {
      expect(USER_TABLE).toContain("roles TEXT");
      expect(USER_TABLE).toContain("groups TEXT");
    });
  });

  describe("SESSION_TABLE", () => {
    it("should define session table with required columns", () => {
      expect(SESSION_TABLE).toContain("CREATE TABLE IF NOT EXISTS session");
      expect(SESSION_TABLE).toContain("id TEXT PRIMARY KEY");
      expect(SESSION_TABLE).toContain("expiresAt TEXT NOT NULL");
      expect(SESSION_TABLE).toContain("token TEXT NOT NULL UNIQUE");
      expect(SESSION_TABLE).toContain("userId TEXT NOT NULL");
    });

    it("should have foreign key to user table", () => {
      expect(SESSION_TABLE).toContain("FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE");
    });

    it("should include optional IP and user agent columns", () => {
      expect(SESSION_TABLE).toContain("ipAddress TEXT");
      expect(SESSION_TABLE).toContain("userAgent TEXT");
    });
  });

  describe("ACCOUNT_TABLE", () => {
    it("should define account table with required columns", () => {
      expect(ACCOUNT_TABLE).toContain("CREATE TABLE IF NOT EXISTS account");
      expect(ACCOUNT_TABLE).toContain("id TEXT PRIMARY KEY");
      expect(ACCOUNT_TABLE).toContain("accountId TEXT NOT NULL");
      expect(ACCOUNT_TABLE).toContain("providerId TEXT NOT NULL");
      expect(ACCOUNT_TABLE).toContain("userId TEXT NOT NULL");
    });

    it("should include OAuth token columns", () => {
      expect(ACCOUNT_TABLE).toContain("accessToken TEXT");
      expect(ACCOUNT_TABLE).toContain("refreshToken TEXT");
      expect(ACCOUNT_TABLE).toContain("idToken TEXT");
      expect(ACCOUNT_TABLE).toContain("accessTokenExpiresAt TEXT");
      expect(ACCOUNT_TABLE).toContain("refreshTokenExpiresAt TEXT");
      expect(ACCOUNT_TABLE).toContain("scope TEXT");
    });

    it("should include password column for credential accounts", () => {
      expect(ACCOUNT_TABLE).toContain("password TEXT");
    });

    it("should have foreign key to user table", () => {
      expect(ACCOUNT_TABLE).toContain("FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE");
    });
  });

  describe("VERIFICATION_TABLE", () => {
    it("should define verification table with required columns", () => {
      expect(VERIFICATION_TABLE).toContain("CREATE TABLE IF NOT EXISTS verification");
      expect(VERIFICATION_TABLE).toContain("id TEXT PRIMARY KEY");
      expect(VERIFICATION_TABLE).toContain("identifier TEXT NOT NULL");
      expect(VERIFICATION_TABLE).toContain("value TEXT NOT NULL");
      expect(VERIFICATION_TABLE).toContain("expiresAt TEXT NOT NULL");
    });
  });

  describe("SCIM_GROUP_TABLE", () => {
    it("should define SCIM group table with required columns", () => {
      expect(SCIM_GROUP_TABLE).toContain("CREATE TABLE IF NOT EXISTS scim_group");
      expect(SCIM_GROUP_TABLE).toContain("id TEXT PRIMARY KEY");
      expect(SCIM_GROUP_TABLE).toContain("displayName TEXT NOT NULL");
      expect(SCIM_GROUP_TABLE).toContain("externalId TEXT");
      expect(SCIM_GROUP_TABLE).toContain("metadata TEXT");
    });
  });

  describe("SCIM_GROUP_MEMBER_TABLE", () => {
    it("should define SCIM group member table with required columns", () => {
      expect(SCIM_GROUP_MEMBER_TABLE).toContain("CREATE TABLE IF NOT EXISTS scim_group_member");
      expect(SCIM_GROUP_MEMBER_TABLE).toContain("id TEXT PRIMARY KEY");
      expect(SCIM_GROUP_MEMBER_TABLE).toContain("groupId TEXT NOT NULL");
      expect(SCIM_GROUP_MEMBER_TABLE).toContain("userId TEXT NOT NULL");
    });

    it("should have foreign keys to group and user tables", () => {
      expect(SCIM_GROUP_MEMBER_TABLE).toContain(
        "FOREIGN KEY (groupId) REFERENCES scim_group(id) ON DELETE CASCADE",
      );
      expect(SCIM_GROUP_MEMBER_TABLE).toContain(
        "FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE",
      );
    });

    it("should enforce unique group-user combinations", () => {
      expect(SCIM_GROUP_MEMBER_TABLE).toContain("UNIQUE(groupId, userId)");
    });
  });

  describe("SCIM_TOKEN_TABLE", () => {
    it("should define SCIM token table with required columns", () => {
      expect(SCIM_TOKEN_TABLE).toContain("CREATE TABLE IF NOT EXISTS scim_token");
      expect(SCIM_TOKEN_TABLE).toContain("id TEXT PRIMARY KEY");
      expect(SCIM_TOKEN_TABLE).toContain("name TEXT NOT NULL");
      expect(SCIM_TOKEN_TABLE).toContain("tokenHash TEXT NOT NULL UNIQUE");
    });

    it("should include tracking columns", () => {
      expect(SCIM_TOKEN_TABLE).toContain("lastUsedAt TEXT");
      expect(SCIM_TOKEN_TABLE).toContain("expiresAt TEXT");
    });
  });

  describe("INDEXES", () => {
    it("should define user indexes", () => {
      expect(INDEXES).toContainEqual("CREATE INDEX IF NOT EXISTS idx_user_email ON user(email)");
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_user_external_id ON user(externalId)",
      );
      expect(INDEXES).toContainEqual("CREATE INDEX IF NOT EXISTS idx_user_active ON user(active)");
    });

    it("should define session indexes", () => {
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(userId)",
      );
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_session_token ON session(token)",
      );
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_session_expires_at ON session(expiresAt)",
      );
    });

    it("should define account indexes", () => {
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_account_user_id ON account(userId)",
      );
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_account_provider_id ON account(providerId)",
      );
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_account_provider_account ON account(providerId, accountId)",
      );
    });

    it("should define verification indexes", () => {
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier)",
      );
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_verification_expires_at ON verification(expiresAt)",
      );
    });

    it("should define SCIM group indexes", () => {
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_scim_group_display_name ON scim_group(displayName)",
      );
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_scim_group_external_id ON scim_group(externalId)",
      );
    });

    it("should define SCIM group member indexes", () => {
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_scim_group_member_group_id ON scim_group_member(groupId)",
      );
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_scim_group_member_user_id ON scim_group_member(userId)",
      );
    });

    it("should define SCIM token indexes", () => {
      expect(INDEXES).toContainEqual(
        "CREATE INDEX IF NOT EXISTS idx_scim_token_hash ON scim_token(tokenHash)",
      );
    });
  });

  describe("ALL_TABLES", () => {
    it("should contain all table definitions in order", () => {
      expect(ALL_TABLES).toHaveLength(7);
      expect(ALL_TABLES[0]).toBe(USER_TABLE);
      expect(ALL_TABLES[1]).toBe(SESSION_TABLE);
      expect(ALL_TABLES[2]).toBe(ACCOUNT_TABLE);
      expect(ALL_TABLES[3]).toBe(VERIFICATION_TABLE);
      expect(ALL_TABLES[4]).toBe(SCIM_GROUP_TABLE);
      expect(ALL_TABLES[5]).toBe(SCIM_GROUP_MEMBER_TABLE);
      expect(ALL_TABLES[6]).toBe(SCIM_TOKEN_TABLE);
    });
  });

  describe("initializeSchema", () => {
    it("should execute all table and index creation statements", async () => {
      const executedStatements: string[] = [];
      const mockExecute = mock(async (sql: string) => {
        executedStatements.push(sql);
      });

      await initializeSchema(mockExecute);

      // Should have executed all tables + all indexes
      const expectedCount = ALL_TABLES.length + INDEXES.length;
      expect(executedStatements).toHaveLength(expectedCount);

      // Verify all tables were executed
      for (const table of ALL_TABLES) {
        expect(executedStatements).toContain(table);
      }

      // Verify all indexes were executed
      for (const index of INDEXES) {
        expect(executedStatements).toContain(index);
      }
    });

    it("should execute tables before indexes", async () => {
      const executedStatements: string[] = [];
      const mockExecute = mock(async (sql: string) => {
        executedStatements.push(sql);
      });

      await initializeSchema(mockExecute);

      // Find positions
      const lastTableIndex = Math.max(...ALL_TABLES.map((t) => executedStatements.indexOf(t)));
      const firstIndexIndex = Math.min(...INDEXES.map((i) => executedStatements.indexOf(i)));

      // All tables should come before any index
      expect(lastTableIndex).toBeLessThan(firstIndexIndex);
    });
  });
});
