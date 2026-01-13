/**
 * API Keys Management
 *
 * Handles API key generation, validation, and permission checking.
 * Keys are stored in the database with bcrypt hashed values.
 *
 * Hierarchy:
 * - Root key (env: ROOT_KEY): Full access, can create any role
 * - Admin keys: Full access + can create editor/viewer/custom keys
 * - Editor keys: Can manage plugins/apps (install, remove, enable, disable)
 * - Viewer keys: Read-only access
 * - Custom keys: Specific permissions defined in permissions array
 */

import { getChildLogger } from "@buntime/shared/logger";
import { getConfig } from "@/config";
import { execute, query, queryOne } from "@/libs/database";

const logger = getChildLogger("ApiKeys");

// ============================================================================
// Types
// ============================================================================

/** API key roles */
export type KeyRole = "admin" | "custom" | "editor" | "viewer";

/** All available permissions */
export type Permission =
  | "apps:install"
  | "apps:read"
  | "apps:remove"
  | "config:read"
  | "config:write"
  | "keys:create"
  | "keys:read"
  | "keys:revoke"
  | "plugins:config"
  | "plugins:disable"
  | "plugins:enable"
  | "plugins:install"
  | "plugins:read"
  | "plugins:remove"
  | "workers:read"
  | "workers:restart";

/** Database row for api_keys table */
interface ApiKeyRow {
  created_at: number;
  created_by: number | null;
  description: string | null;
  expires_at: number | null;
  id: number;
  key_hash: string;
  key_prefix: string;
  last_used_at: number | null;
  name: string;
  permissions: string;
  revoked_at: number | null;
  role: KeyRole;
}

/** API key data returned by queries (without hash) */
export interface ApiKeyData {
  createdAt: number;
  createdBy: number | null;
  description: string | null;
  expiresAt: number | null;
  id: number;
  keyPrefix: string;
  lastUsedAt: number | null;
  name: string;
  permissions: Permission[];
  revokedAt: number | null;
  role: KeyRole;
}

/** Input for creating a new API key */
export interface CreateKeyInput {
  createdBy?: number | null;
  description?: string;
  expiresAt?: number | null;
  name: string;
  permissions?: Permission[];
  role: KeyRole;
}

/** Result of creating a new API key (includes full key, only returned once) */
export interface CreateKeyResult {
  id: number;
  key: string;
  keyPrefix: string;
  name: string;
  role: KeyRole;
}

/** Validated key info for request context */
export interface ValidatedKey {
  id: number | null; // null = root key
  name: string;
  permissions: Permission[];
  role: KeyRole | "root";
}

// ============================================================================
// Constants
// ============================================================================

/** Key prefix for identification */
const KEY_PREFIX = "btk_";

/** Length of the random part of the key (32 chars) */
const KEY_LENGTH = 32;

/** Characters used for key generation (base62) */
const KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Bcrypt cost factor */
const BCRYPT_COST = 10;

/** Permissions by role */
const RolePermissions: Record<KeyRole, Permission[] | "*"> = {
  admin: "*", // Full access
  custom: [], // Defined per key
  editor: [
    "apps:install",
    "apps:read",
    "apps:remove",
    "plugins:config",
    "plugins:disable",
    "plugins:enable",
    "plugins:install",
    "plugins:read",
    "plugins:remove",
    "workers:read",
    "workers:restart",
  ],
  viewer: ["apps:read", "config:read", "plugins:read", "workers:read"],
};

/** Roles that can be created by each role */
const CreateableRoles: Record<KeyRole, KeyRole[]> = {
  admin: ["custom", "editor", "viewer"], // Admin can't create admin (only root can)
  custom: [],
  editor: [],
  viewer: [],
};

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate a random API key
 * Format: btk_<32 random chars>
 */
function generateKey(): string {
  const randomPart = Array.from(
    { length: KEY_LENGTH },
    () => KEY_CHARS[Math.floor(Math.random() * KEY_CHARS.length)],
  ).join("");
  return `${KEY_PREFIX}${randomPart}`;
}

/**
 * Extract the prefix from a key for display
 * Returns first 12 characters (btk_xxxx...)
 */
function extractPrefix(key: string): string {
  return key.slice(0, 12) + "...";
}

/**
 * Hash a key using bcrypt
 */
async function hashKey(key: string): Promise<string> {
  return Bun.password.hash(key, { algorithm: "bcrypt", cost: BCRYPT_COST });
}

/**
 * Verify a key against a hash
 */
async function verifyKey(key: string, hash: string): Promise<boolean> {
  return Bun.password.verify(key, hash);
}

// ============================================================================
// Row Conversion
// ============================================================================

/**
 * Convert database row to ApiKeyData
 */
function rowToApiKeyData(row: ApiKeyRow): ApiKeyData {
  return {
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    expiresAt: row.expires_at,
    id: row.id,
    keyPrefix: row.key_prefix,
    lastUsedAt: row.last_used_at,
    name: row.name,
    permissions: JSON.parse(row.permissions || "[]") as Permission[],
    revokedAt: row.revoked_at,
    role: row.role,
  };
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new API key
 * Returns the full key (only time it's visible)
 */
export async function createApiKey(input: CreateKeyInput): Promise<CreateKeyResult> {
  const key = generateKey();
  const keyHash = await hashKey(key);
  const keyPrefix = extractPrefix(key);

  const permissions = input.permissions ?? [];
  const expiresAt = input.expiresAt ?? null;
  const createdBy = input.createdBy ?? null;
  const description = input.description ?? null;

  // Insert and get the ID
  await execute(
    `
    INSERT INTO api_keys (name, key_hash, key_prefix, role, permissions, created_by, expires_at, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      input.name,
      keyHash,
      keyPrefix,
      input.role,
      JSON.stringify(permissions),
      createdBy,
      expiresAt,
      description,
    ],
  );

  // Get the last inserted ID
  const result = await queryOne<{ id: number }>(
    "SELECT id FROM api_keys WHERE key_prefix = ? ORDER BY id DESC LIMIT 1",
    [keyPrefix],
  );

  const id = result?.id ?? 0;

  logger.info(`API key created: ${input.name} (id: ${id}, role: ${input.role})`);

  return {
    id,
    key,
    keyPrefix,
    name: input.name,
    role: input.role,
  };
}

/**
 * Get all API keys (without hashes)
 * Filters out revoked keys by default
 */
export async function getAllApiKeys(): Promise<ApiKeyData[]> {
  const rows = await query<ApiKeyRow>(
    "SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC",
  );
  return rows.map(rowToApiKeyData);
}

/**
 * Get an API key by ID
 */
export async function getApiKeyById(id: number): Promise<ApiKeyData | null> {
  const row = await queryOne<ApiKeyRow>("SELECT * FROM api_keys WHERE id = ?", [id]);
  return row ? rowToApiKeyData(row) : null;
}

/**
 * Update an API key (name and description only)
 */
export async function updateApiKey(
  id: number,
  updates: { description?: string; name?: string },
): Promise<ApiKeyData | null> {
  const existing = await getApiKeyById(id);
  if (!existing) return null;

  const name = updates.name ?? existing.name;
  const description = updates.description ?? existing.description;

  await execute("UPDATE api_keys SET name = ?, description = ? WHERE id = ?", [
    name,
    description,
    id,
  ]);

  logger.info(`API key updated: ${name} (id: ${id})`);

  return getApiKeyById(id);
}

/**
 * Revoke an API key (soft delete)
 */
export async function revokeApiKey(id: number): Promise<boolean> {
  const existing = await getApiKeyById(id);

  if (!existing) return false;
  if (existing.revokedAt) return false; // Already revoked

  await execute("UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ?", [id]);

  logger.info(`API key revoked: ${existing.name} (id: ${id})`);

  return true;
}

/**
 * Update last_used_at timestamp for a key
 */
export async function touchApiKey(id: number): Promise<void> {
  await execute("UPDATE api_keys SET last_used_at = unixepoch() WHERE id = ?", [id]);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate an API key and return key info if valid
 * Checks: existence, hash match, not revoked, not expired
 */
export async function validateApiKey(key: string): Promise<ValidatedKey | null> {
  // First check if it's the root key
  const config = getConfig();
  if (config.rootKey && key === config.rootKey) {
    return {
      id: null,
      name: "root",
      permissions: [], // Root has all permissions implicitly
      role: "root",
    };
  }

  // Not root key, check database
  if (!key.startsWith(KEY_PREFIX)) {
    return null;
  }

  const keyPrefix = extractPrefix(key);

  // Find keys with matching prefix (there should be only one due to uniqueness)
  const rows = await query<ApiKeyRow>("SELECT * FROM api_keys WHERE key_prefix = ?", [keyPrefix]);

  for (const row of rows) {
    // Verify hash
    if (await verifyKey(key, row.key_hash)) {
      // Check if revoked
      if (row.revoked_at) {
        logger.debug(`API key is revoked: ${row.name}`);
        return null;
      }

      // Check if expired
      if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) {
        logger.debug(`API key is expired: ${row.name}`);
        return null;
      }

      // Update last_used_at
      await touchApiKey(row.id);

      // Get effective permissions
      const permissions = getEffectivePermissions(row.role as KeyRole, row.permissions);

      return {
        id: row.id,
        name: row.name,
        permissions,
        role: row.role as KeyRole,
      };
    }
  }

  return null;
}

// ============================================================================
// Permissions
// ============================================================================

/**
 * Get effective permissions for a role
 */
function getEffectivePermissions(role: KeyRole, permissionsJson: string): Permission[] {
  const rolePerms = RolePermissions[role];

  if (rolePerms === "*") {
    // Admin has all permissions
    return Object.values(RolePermissions)
      .filter((p): p is Permission[] => Array.isArray(p))
      .flat();
  }

  if (role === "custom") {
    return JSON.parse(permissionsJson || "[]") as Permission[];
  }

  return rolePerms;
}

/**
 * Check if a key has a specific permission
 */
export function hasPermission(validatedKey: ValidatedKey, permission: Permission): boolean {
  // Root has all permissions
  if (validatedKey.role === "root") return true;

  // Admin has all permissions
  if (validatedKey.role === "admin") return true;

  // Check specific permissions
  return validatedKey.permissions.includes(permission);
}

/**
 * Check if a key can create a specific role
 */
export function canCreateRole(creatorRole: KeyRole | "root", targetRole: KeyRole): boolean {
  // Root can create any role
  if (creatorRole === "root") return true;

  // Check createable roles for creator's role
  const createable = CreateableRoles[creatorRole as KeyRole] ?? [];
  return createable.includes(targetRole);
}

/**
 * Get all valid roles
 */
export function getValidRoles(): KeyRole[] {
  return ["admin", "editor", "viewer", "custom"];
}

/**
 * Get all valid permissions
 */
export function getValidPermissions(): Permission[] {
  return [
    "apps:install",
    "apps:read",
    "apps:remove",
    "config:read",
    "config:write",
    "keys:create",
    "keys:read",
    "keys:revoke",
    "plugins:config",
    "plugins:disable",
    "plugins:enable",
    "plugins:install",
    "plugins:read",
    "plugins:remove",
    "workers:read",
    "workers:restart",
  ];
}

/**
 * Get permissions for a role (for UI display)
 */
export function getPermissionsForRole(role: KeyRole): Permission[] | "*" {
  return RolePermissions[role];
}
