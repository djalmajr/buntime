/**
 * Runtime configuration database (LibSQL)
 *
 * Centralized storage for plugin state and configuration.
 * Uses @libsql/client/http for both local SQLite and remote libSQL servers.
 *
 * Single table design with manifest fields as columns:
 * - Structural fields: name, base, entrypoint, dependencies, etc.
 * - State fields: enabled, version
 * - Dynamic config: config (JSON for plugin-specific settings)
 */

import { getChildLogger } from "@buntime/shared/logger";
import type { PluginManifest } from "@buntime/shared/types";
import { type Client, createClient } from "@libsql/client/http";
import { getConfig } from "@/config";

const logger = getChildLogger("Database");

let client: Client | null = null;

/**
 * Initialize the runtime database
 * Creates the database connection and runs migrations if needed
 */
export async function initDatabase(): Promise<void> {
  const config = getConfig();

  // For multi-tenant libsql servers, namespace is specified via Host header
  // Set LIBSQL_NAMESPACE env var to use namespace-based routing
  const namespace = config.libsqlNamespace;

  // If namespace is specified, create a custom fetch that adds Host header
  const customFetch = namespace
    ? (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set("Host", namespace);
        return fetch(input, { ...init, headers });
      }
    : undefined;

  client = createClient({
    authToken: config.libsqlAuthToken,
    fetch: customFetch,
    url: config.libsqlUrl,
  });

  // Run migrations
  await runMigrations();

  logger.info(`Database initialized: ${config.libsqlUrl}${namespace ? ` (namespace: ${namespace})` : ""}`);
}

/**
 * Get the database client
 * @throws Error if database is not initialized
 */
export function getClient(): Client {
  if (!client) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return client;
}

/**
 * Execute a query and return all rows
 */
export async function query<T = unknown>(sql: string, args?: unknown[]): Promise<T[]> {
  const result = await getClient().execute({
    args: (args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
    sql,
  });
  return result.rows as T[];
}

/**
 * Execute a query and return the first row or null
 */
export async function queryOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, args);
  return rows[0] ?? null;
}

/**
 * Execute a statement (INSERT, UPDATE, DELETE, etc.)
 */
export async function execute(sql: string, args?: unknown[]): Promise<void> {
  await getClient().execute({
    args: (args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
    sql,
  });
}

/**
 * Execute multiple statements in a batch
 */
export async function batch(statements: Array<{ args?: unknown[]; sql: string }>): Promise<void> {
  await getClient().batch(
    statements.map((s) => ({
      args: (s.args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
      sql: s.sql,
    })),
  );
}

/**
 * Run database migrations
 */
async function runMigrations(): Promise<void> {
  // Check if we need to migrate from old schema (name as PRIMARY KEY)
  const tableInfo = await query<{
    cid: number;
    name: string;
    pk: number;
    type: string;
  }>("PRAGMA table_info(plugins)");

  const hasOldSchema =
    tableInfo.length > 0 && tableInfo.some((c) => c.name === "name" && c.pk === 1);

  if (hasOldSchema) {
    // Migrate: rename old table, create new, copy data, drop old
    logger.info("Migrating plugins table to new schema with id column...");
    await execute("ALTER TABLE plugins RENAME TO plugins_old");

    await execute(`
      CREATE TABLE plugins (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        name                  TEXT UNIQUE NOT NULL,

        -- State (mutable via API)
        enabled               INTEGER NOT NULL DEFAULT 0,
        version               TEXT DEFAULT 'latest',

        -- Structural (from manifest, immutable via API)
        base                  TEXT NOT NULL DEFAULT '/',
        entrypoint            TEXT,
        dependencies          TEXT DEFAULT '[]',
        optional_dependencies TEXT DEFAULT '[]',
        fragment              TEXT,
        menus                 TEXT DEFAULT '[]',

        -- Dynamic config (plugin-specific, mutable via API)
        config                TEXT DEFAULT '{}',

        -- Timestamps
        created_at            INTEGER DEFAULT (unixepoch()),
        updated_at            INTEGER DEFAULT (unixepoch())
      )
    `);

    // Copy data from old table
    await execute(`
      INSERT INTO plugins (name, enabled, version, base, entrypoint, dependencies,
                           optional_dependencies, fragment, menus, config, created_at, updated_at)
      SELECT name, enabled, version, base, entrypoint, dependencies,
             optional_dependencies, fragment, menus, config, created_at, updated_at
      FROM plugins_old
    `);

    await execute("DROP TABLE plugins_old");
    logger.info("Migration complete");
  } else if (tableInfo.length === 0) {
    // Fresh install: create new schema
    await execute(`
      CREATE TABLE IF NOT EXISTS plugins (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        name                  TEXT UNIQUE NOT NULL,

        -- State (mutable via API)
        enabled               INTEGER NOT NULL DEFAULT 0,
        version               TEXT DEFAULT 'latest',

        -- Structural (from manifest, immutable via API)
        base                  TEXT NOT NULL DEFAULT '/',
        entrypoint            TEXT,
        dependencies          TEXT DEFAULT '[]',
        optional_dependencies TEXT DEFAULT '[]',
        fragment              TEXT,
        menus                 TEXT DEFAULT '[]',

        -- Dynamic config (plugin-specific, mutable via API)
        config                TEXT DEFAULT '{}',

        -- Timestamps
        created_at            INTEGER DEFAULT (unixepoch()),
        updated_at            INTEGER DEFAULT (unixepoch())
      )
    `);
  }

  // Create API keys table for hierarchical key management
  await execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      key_hash        TEXT NOT NULL UNIQUE,    -- bcrypt hash of the key
      key_prefix      TEXT NOT NULL,           -- first 12 chars for display (btk_xxxx...)

      -- Permissions
      role            TEXT NOT NULL,           -- 'admin' | 'editor' | 'viewer' | 'custom'
      permissions     TEXT DEFAULT '[]',       -- JSON array of permissions (used when role='custom')

      -- Metadata
      created_by      INTEGER,                 -- NULL = created by root, otherwise id of creating key
      created_at      INTEGER DEFAULT (unixepoch()),
      expires_at      INTEGER,                 -- NULL = never expires
      last_used_at    INTEGER,
      revoked_at      INTEGER,                 -- NULL = active, timestamp = revoked

      -- Audit
      description     TEXT,                    -- optional notes

      FOREIGN KEY (created_by) REFERENCES api_keys(id) ON DELETE SET NULL
    )
  `);

  // Indexes for API keys
  await execute("CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)");
  await execute("CREATE INDEX IF NOT EXISTS idx_api_keys_role ON api_keys(role)");
  await execute("CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by)");

  // Create audit logs table for tracking all actions
  await execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp       INTEGER DEFAULT (unixepoch()),

      -- Who performed the action
      actor_id        INTEGER,                 -- NULL = root, otherwise api_key id
      actor_name      TEXT NOT NULL,           -- 'root' or key name

      -- What was done
      action          TEXT NOT NULL,           -- 'key.create' | 'key.revoke' | 'plugin.install' | etc
      resource_type   TEXT,                    -- 'key' | 'plugin' | 'app'
      resource_id     TEXT,                    -- id of the affected resource
      resource_name   TEXT,                    -- name of the affected resource

      -- Additional details
      details         TEXT,                    -- JSON with extra data
      ip_address      TEXT,                    -- IP of the request
      user_agent      TEXT                     -- User-Agent of the request
    )
  `);

  // Indexes for audit logs
  await execute("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)");
  await execute("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id)");
  await execute("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)");
}

/**
 * Close the database connection
 * Call this during shutdown
 */
export function closeDatabase(): void {
  if (client) {
    client.close();
    client = null;
    logger.debug("Database connection closed");
  }
}

// ============================================================================
// Plugin Row Types
// ============================================================================

interface PluginRow {
  base: string;
  config: string;
  created_at: number;
  dependencies: string;
  enabled: number;
  entrypoint: string | null;
  fragment: string | null;
  id: number;
  menus: string;
  name: string;
  optional_dependencies: string;
  updated_at: number;
  version: string;
}

/**
 * Convert a database row to PluginData
 */
function rowToPluginData(row: PluginRow): PluginData {
  return {
    base: row.base,
    config: JSON.parse(row.config || "{}") as Record<string, unknown>,
    createdAt: row.created_at,
    dependencies: JSON.parse(row.dependencies || "[]") as string[],
    enabled: row.enabled === 1,
    entrypoint: row.entrypoint,
    fragment: row.fragment ? (JSON.parse(row.fragment) as Record<string, unknown>) : null,
    id: row.id,
    menus: JSON.parse(row.menus || "[]") as Array<Record<string, unknown>>,
    name: row.name,
    optionalDependencies: JSON.parse(row.optional_dependencies || "[]") as string[],
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/**
 * Plugin data as returned by getAllPlugins
 */
export interface PluginData {
  base: string;
  config: Record<string, unknown>;
  createdAt: number;
  dependencies: string[];
  enabled: boolean;
  entrypoint: string | null;
  fragment: Record<string, unknown> | null;
  id: number;
  menus: Array<Record<string, unknown>>;
  name: string;
  optionalDependencies: string[];
  updatedAt: number;
  version: string;
}

// ============================================================================
// Plugin Seed (from manifest)
// ============================================================================

/**
 * Known manifest fields (non-config)
 * These are stored in dedicated columns, not in config JSON
 */
const MANIFEST_FIELDS = new Set([
  "name",
  "enabled",
  "base",
  "entrypoint",
  "dependencies",
  "optionalDependencies",
  "fragment",
  "menus",
]);

/**
 * Extract plugin-specific config from manifest
 * Returns all fields except known manifest fields
 */
function extractPluginConfig(manifest: PluginManifest): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!MANIFEST_FIELDS.has(key)) {
      config[key] = value;
    }
  }
  return config;
}

/**
 * Seed a plugin from its manifest
 * - If plugin doesn't exist: INSERT with all manifest data
 * - If plugin exists: UPDATE structural fields only, preserve state (enabled, config overrides)
 */
export async function seedPluginFromManifest(manifest: PluginManifest): Promise<void> {
  const name = manifest.name;
  const base = manifest.base;
  const entrypoint = manifest.entrypoint ?? null;
  const dependencies = JSON.stringify(manifest.dependencies ?? []);
  const optionalDependencies = JSON.stringify(manifest.optionalDependencies ?? []);
  const fragment = manifest.fragment ? JSON.stringify(manifest.fragment) : null;
  const menus = JSON.stringify(manifest.menus ?? []);
  const defaultEnabled = manifest.enabled !== false ? 1 : 0;
  const pluginConfig = extractPluginConfig(manifest);

  // Check if plugin exists
  const existing = await queryOne<{ config: string; name: string }>(
    "SELECT name, config FROM plugins WHERE name = ?",
    [name],
  );

  if (!existing) {
    // INSERT: New plugin - use manifest values including enabled and config
    await execute(
      `
      INSERT INTO plugins (
        name, enabled, version, base, entrypoint,
        dependencies, optional_dependencies, fragment, menus, config,
        created_at, updated_at
      ) VALUES (?, ?, 'latest', ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `,
      [
        name,
        defaultEnabled,
        base,
        entrypoint,
        dependencies,
        optionalDependencies,
        fragment,
        menus,
        JSON.stringify(pluginConfig),
      ],
    );
    logger.debug(`Seeded new plugin: ${name} (enabled: ${defaultEnabled === 1})`);
  } else {
    // Plugin already exists - database is source of truth, skip update
    // To update plugin config/structure, use the API endpoints
    logger.debug(`Plugin already exists in database: ${name} (skipping seed)`);
  }
}

// ============================================================================
// Plugin State Management
// ============================================================================

/**
 * Get a plugin row by name
 */
async function getPluginRow(name: string): Promise<PluginRow | null> {
  return queryOne<PluginRow>("SELECT * FROM plugins WHERE name = ?", [name]);
}

/**
 * Check if a plugin is enabled
 * Returns false if plugin is not in the database or is disabled
 */
export async function isPluginEnabled(name: string): Promise<boolean> {
  const row = await getPluginRow(name);
  return row?.enabled === 1;
}

/**
 * Enable a plugin
 */
export async function enablePlugin(name: string): Promise<void> {
  const existing = await getPluginRow(name);

  if (!existing) {
    // Plugin not in DB - can't enable something that wasn't seeded
    throw new Error(`Plugin "${name}" not found in database. Deploy the plugin first.`);
  }

  await execute(`UPDATE plugins SET enabled = 1, updated_at = unixepoch() WHERE name = ?`, [name]);
  logger.info(`Plugin enabled: ${name}`);
}

/**
 * Disable a plugin
 */
export async function disablePlugin(name: string): Promise<void> {
  await execute(`UPDATE plugins SET enabled = 0, updated_at = unixepoch() WHERE name = ?`, [name]);
  logger.info(`Plugin disabled: ${name}`);
}

/**
 * Enable a plugin by ID
 */
export async function enablePluginById(id: number): Promise<PluginData | null> {
  const existing = await queryOne<PluginRow>("SELECT * FROM plugins WHERE id = ?", [id]);

  if (!existing) {
    return null;
  }

  await execute(`UPDATE plugins SET enabled = 1, updated_at = unixepoch() WHERE id = ?`, [id]);
  logger.info(`Plugin enabled: ${existing.name} (id: ${id})`);

  return getPluginById(id);
}

/**
 * Disable a plugin by ID
 */
export async function disablePluginById(id: number): Promise<PluginData | null> {
  const existing = await queryOne<PluginRow>("SELECT * FROM plugins WHERE id = ?", [id]);

  if (!existing) {
    return null;
  }

  await execute(`UPDATE plugins SET enabled = 0, updated_at = unixepoch() WHERE id = ?`, [id]);
  logger.info(`Plugin disabled: ${existing.name} (id: ${id})`);

  return getPluginById(id);
}

/**
 * Remove a plugin by ID
 */
export async function removePluginById(id: number): Promise<boolean> {
  const existing = await queryOne<{ name: string }>("SELECT name FROM plugins WHERE id = ?", [id]);

  if (!existing) {
    return false;
  }

  await execute("DELETE FROM plugins WHERE id = ?", [id]);
  logger.info(`Plugin removed from database: ${existing.name} (id: ${id})`);

  return true;
}

/**
 * Get all enabled plugin names
 */
export async function getEnabledPlugins(): Promise<string[]> {
  const rows = await query<{ name: string }>("SELECT name FROM plugins WHERE enabled = 1");
  return rows.map((r) => r.name);
}

// ============================================================================
// Plugin Version
// ============================================================================

/**
 * Get the active version for a plugin
 * Returns "latest" if not set
 */
export async function getPluginVersion(name: string): Promise<string> {
  const row = await getPluginRow(name);
  return row?.version ?? "latest";
}

/**
 * Set the active version for a plugin
 */
export async function setPluginVersion(name: string, version: string): Promise<void> {
  const existing = await getPluginRow(name);

  if (!existing) {
    throw new Error(`Plugin "${name}" not found in database`);
  }

  await execute(`UPDATE plugins SET version = ?, updated_at = unixepoch() WHERE name = ?`, [
    version,
    name,
  ]);
  logger.info(`Plugin version set: ${name}@${version}`);
}

/**
 * Reset plugin version to "latest"
 */
export async function resetPluginVersion(name: string): Promise<void> {
  await setPluginVersion(name, "latest");
}

// ============================================================================
// Plugin Config (JSON)
// ============================================================================

/**
 * Get all configuration for a plugin
 * Returns parsed JSON object
 */
export async function getPluginConfig(name: string): Promise<Record<string, unknown>> {
  const row = await getPluginRow(name);
  if (!row?.config) return {};
  try {
    return JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Get a single configuration value for a plugin
 */
export async function getPluginConfigValue(name: string, key: string): Promise<unknown> {
  const config = await getPluginConfig(name);
  return config[key];
}

/**
 * Set a configuration value for a plugin
 * Merges with existing config
 */
export async function setPluginConfig(name: string, key: string, value: unknown): Promise<void> {
  const existing = await getPluginRow(name);

  if (!existing) {
    throw new Error(`Plugin "${name}" not found in database`);
  }

  const config = await getPluginConfig(name);
  config[key] = value;

  await execute(`UPDATE plugins SET config = ?, updated_at = unixepoch() WHERE name = ?`, [
    JSON.stringify(config),
    name,
  ]);
  logger.debug(`Plugin config set: ${name}.${key}`);
}

/**
 * Set all configuration for a plugin (replaces existing)
 */
export async function setPluginConfigAll(
  name: string,
  config: Record<string, unknown>,
): Promise<void> {
  const existing = await getPluginRow(name);

  if (!existing) {
    throw new Error(`Plugin "${name}" not found in database`);
  }

  await execute(`UPDATE plugins SET config = ?, updated_at = unixepoch() WHERE name = ?`, [
    JSON.stringify(config),
    name,
  ]);
  logger.debug(`Plugin config replaced: ${name}`);
}

/**
 * Delete a configuration key for a plugin
 * If key is not provided, clears all config
 */
export async function deletePluginConfig(name: string, key?: string): Promise<void> {
  if (key) {
    const config = await getPluginConfig(name);
    delete config[key];
    await execute(`UPDATE plugins SET config = ?, updated_at = unixepoch() WHERE name = ?`, [
      JSON.stringify(config),
      name,
    ]);
    logger.debug(`Plugin config deleted: ${name}.${key}`);
  } else {
    await execute(`UPDATE plugins SET config = '{}', updated_at = unixepoch() WHERE name = ?`, [
      name,
    ]);
    logger.debug(`All plugin config cleared: ${name}`);
  }
}

// ============================================================================
// Plugin CRUD
// ============================================================================

/**
 * Get a single plugin with its full data
 */
export async function getPlugin(name: string): Promise<PluginData | null> {
  const row = await getPluginRow(name);
  return row ? rowToPluginData(row) : null;
}

/**
 * Get a plugin by its database ID
 */
export async function getPluginById(id: number): Promise<PluginData | null> {
  const row = await queryOne<PluginRow>("SELECT * FROM plugins WHERE id = ?", [id]);
  return row ? rowToPluginData(row) : null;
}

/**
 * Get all plugins with their full state
 */
export async function getAllPlugins(): Promise<PluginData[]> {
  const rows = await query<PluginRow>("SELECT * FROM plugins ORDER BY name");
  return rows.map(rowToPluginData);
}

/**
 * Remove a plugin from the database completely
 */
export async function removePluginFromDb(name: string): Promise<void> {
  await execute("DELETE FROM plugins WHERE name = ?", [name]);
  logger.info(`Plugin removed from database: ${name}`);
}
