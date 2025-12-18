/**
 * Database schema definitions for plugin-authn
 *
 * Tables:
 * - user: User accounts (better-auth core + SCIM extensions)
 * - session: User sessions (better-auth)
 * - account: OAuth/credential accounts (better-auth)
 * - verification: Email verification tokens (better-auth)
 * - scim_group: SCIM groups
 * - scim_group_member: User-group membership
 * - scim_token: Bearer tokens for SCIM API
 */

/**
 * User table schema
 * Combines better-auth core fields with SCIM extensions
 */
export const USER_TABLE = `
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  -- SCIM extensions
  externalId TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  -- OAuth provider data (Keycloak roles, groups, etc.)
  roles TEXT,
  groups TEXT
)`;

/**
 * Session table schema
 * Stores user sessions with expiration
 */
export const SESSION_TABLE = `
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
)`;

/**
 * Account table schema
 * Links OAuth providers and credentials to users
 */
export const ACCOUNT_TABLE = `
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
)`;

/**
 * Verification table schema
 * Email verification and password reset tokens
 */
export const VERIFICATION_TABLE = `
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/**
 * SCIM Group table schema
 */
export const SCIM_GROUP_TABLE = `
CREATE TABLE IF NOT EXISTS scim_group (
  id TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  externalId TEXT,
  metadata TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
)`;

/**
 * SCIM Group Member table schema
 * Many-to-many relationship between users and groups
 */
export const SCIM_GROUP_MEMBER_TABLE = `
CREATE TABLE IF NOT EXISTS scim_group_member (
  id TEXT PRIMARY KEY,
  groupId TEXT NOT NULL,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (groupId) REFERENCES scim_group(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE,
  UNIQUE(groupId, userId)
)`;

/**
 * SCIM Token table schema
 * Bearer tokens for SCIM API authentication
 */
export const SCIM_TOKEN_TABLE = `
CREATE TABLE IF NOT EXISTS scim_token (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  lastUsedAt TEXT,
  expiresAt TEXT
)`;

/**
 * Indexes for performance
 */
export const INDEXES = [
  // User indexes
  "CREATE INDEX IF NOT EXISTS idx_user_email ON user(email)",
  "CREATE INDEX IF NOT EXISTS idx_user_external_id ON user(externalId)",
  "CREATE INDEX IF NOT EXISTS idx_user_active ON user(active)",

  // Session indexes
  "CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(userId)",
  "CREATE INDEX IF NOT EXISTS idx_session_token ON session(token)",
  "CREATE INDEX IF NOT EXISTS idx_session_expires_at ON session(expiresAt)",

  // Account indexes
  "CREATE INDEX IF NOT EXISTS idx_account_user_id ON account(userId)",
  "CREATE INDEX IF NOT EXISTS idx_account_provider_id ON account(providerId)",
  "CREATE INDEX IF NOT EXISTS idx_account_provider_account ON account(providerId, accountId)",

  // Verification indexes
  "CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier)",
  "CREATE INDEX IF NOT EXISTS idx_verification_expires_at ON verification(expiresAt)",

  // SCIM Group indexes
  "CREATE INDEX IF NOT EXISTS idx_scim_group_display_name ON scim_group(displayName)",
  "CREATE INDEX IF NOT EXISTS idx_scim_group_external_id ON scim_group(externalId)",

  // SCIM Group Member indexes
  "CREATE INDEX IF NOT EXISTS idx_scim_group_member_group_id ON scim_group_member(groupId)",
  "CREATE INDEX IF NOT EXISTS idx_scim_group_member_user_id ON scim_group_member(userId)",

  // SCIM Token indexes
  "CREATE INDEX IF NOT EXISTS idx_scim_token_hash ON scim_token(tokenHash)",
];

/**
 * All table creation statements in order
 */
export const ALL_TABLES = [
  USER_TABLE,
  SESSION_TABLE,
  ACCOUNT_TABLE,
  VERIFICATION_TABLE,
  SCIM_GROUP_TABLE,
  SCIM_GROUP_MEMBER_TABLE,
  SCIM_TOKEN_TABLE,
];

/**
 * Initialize all tables and indexes
 */
export async function initializeSchema(execute: (sql: string) => Promise<void>): Promise<void> {
  // Create tables
  for (const table of ALL_TABLES) {
    await execute(table);
  }

  // Create indexes
  for (const index of INDEXES) {
    await execute(index);
  }
}
