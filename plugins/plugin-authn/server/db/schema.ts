/**
 * Drizzle schema definitions for plugin-authn
 *
 * Tables:
 * - user: User accounts (better-auth core + SCIM extensions)
 * - session: User sessions (better-auth)
 * - account: OAuth/credential accounts (better-auth)
 * - verification: Email verification tokens (better-auth)
 * - scimGroup: SCIM groups
 * - scimGroupMember: User-group membership
 * - scimToken: Bearer tokens for SCIM API
 */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * User table
 * Combines better-auth core fields with SCIM extensions
 */
export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: text("createdAt").notNull().default("(datetime('now'))"),
    updatedAt: text("updatedAt").notNull().default("(datetime('now'))"),
    // SCIM extensions
    externalId: text("externalId"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    metadata: text("metadata"),
    // OAuth provider data (Keycloak roles, groups, etc.)
    roles: text("roles"),
    groups: text("groups"),
  },
  (table) => [
    index("idx_user_email").on(table.email),
    index("idx_user_external_id").on(table.externalId),
    index("idx_user_active").on(table.active),
  ],
);

/**
 * Session table
 * Stores user sessions with expiration
 */
export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: text("expiresAt").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: text("createdAt").notNull().default("(datetime('now'))"),
    updatedAt: text("updatedAt").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_session_user_id").on(table.userId),
    index("idx_session_token").on(table.token),
    index("idx_session_expires_at").on(table.expiresAt),
  ],
);

/**
 * Account table
 * Links OAuth providers and credentials to users
 */
export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: text("accessTokenExpiresAt"),
    refreshTokenExpiresAt: text("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: text("createdAt").notNull().default("(datetime('now'))"),
    updatedAt: text("updatedAt").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_account_user_id").on(table.userId),
    index("idx_account_provider_id").on(table.providerId),
    index("idx_account_provider_account").on(table.providerId, table.accountId),
  ],
);

/**
 * Verification table
 * Email verification and password reset tokens
 */
export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: text("expiresAt").notNull(),
    createdAt: text("createdAt").notNull().default("(datetime('now'))"),
    updatedAt: text("updatedAt").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_verification_identifier").on(table.identifier),
    index("idx_verification_expires_at").on(table.expiresAt),
  ],
);

/**
 * SCIM Group table
 */
export const scimGroup = sqliteTable(
  "scim_group",
  {
    id: text("id").primaryKey(),
    displayName: text("displayName").notNull(),
    externalId: text("externalId"),
    metadata: text("metadata"),
    createdAt: text("createdAt").notNull().default("(datetime('now'))"),
    updatedAt: text("updatedAt").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_scim_group_display_name").on(table.displayName),
    index("idx_scim_group_external_id").on(table.externalId),
  ],
);

/**
 * SCIM Group Member table
 * Many-to-many relationship between users and groups
 */
export const scimGroupMember = sqliteTable(
  "scim_group_member",
  {
    id: text("id").primaryKey(),
    groupId: text("groupId")
      .notNull()
      .references(() => scimGroup.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: text("createdAt").notNull().default("(datetime('now'))"),
  },
  (table) => [
    index("idx_scim_group_member_group_id").on(table.groupId),
    index("idx_scim_group_member_user_id").on(table.userId),
    uniqueIndex("idx_scim_group_member_unique").on(table.groupId, table.userId),
  ],
);

/**
 * SCIM Token table
 * Bearer tokens for SCIM API authentication
 */
export const scimToken = sqliteTable(
  "scim_token",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("tokenHash").notNull().unique(),
    createdAt: text("createdAt").notNull().default("(datetime('now'))"),
    lastUsedAt: text("lastUsedAt"),
    expiresAt: text("expiresAt"),
  },
  (table) => [index("idx_scim_token_hash").on(table.tokenHash)],
);
