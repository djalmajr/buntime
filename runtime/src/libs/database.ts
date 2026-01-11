/**
 * Runtime configuration database (SQLite)
 *
 * Centralized storage for plugin state and configuration.
 * Uses SQLite with WAL mode for multi-process access (Kubernetes pods).
 *
 * Single table design with manifest fields as columns:
 * - Structural fields: name, base, entrypoint, dependencies, etc.
 * - State fields: enabled, version
 * - Dynamic config: config (JSON for plugin-specific settings)
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { getChildLogger } from "@buntime/shared/logger";
import type { PluginManifest } from "@buntime/shared/types";
import { getConfig } from "@/config";

const logger = getChildLogger("Database");

let db: Database | null = null;

/**
 * Initialize the runtime database
 * Creates the database file and runs migrations if needed
 */
function initDatabase(): Database {
  const config = getConfig();
  const dbDir = config.configDir;

  // Ensure directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    logger.info(`Created config directory: ${dbDir}`);
  }

  const dbPath = `${dbDir}/buntime.db`;
  const database = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent access (multi-pod)
  database.run("PRAGMA journal_mode = WAL");

  // Run migrations
  runMigrations(database);

  logger.info(`Database initialized: ${dbPath}`);
  return database;
}

/**
 * Run database migrations
 */
function runMigrations(database: Database): void {
  // Check if we need to migrate from old schema (name as PRIMARY KEY)
  const tableInfo = database.query("PRAGMA table_info(plugins)").all() as Array<{
    cid: number;
    name: string;
    pk: number;
    type: string;
  }>;

  const hasOldSchema =
    tableInfo.length > 0 && tableInfo.some((c) => c.name === "name" && c.pk === 1);

  if (hasOldSchema) {
    // Migrate: rename old table, create new, copy data, drop old
    logger.info("Migrating plugins table to new schema with id column...");
    database.run("ALTER TABLE plugins RENAME TO plugins_old");

    database.run(`
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
    database.run(`
      INSERT INTO plugins (name, enabled, version, base, entrypoint, dependencies,
                           optional_dependencies, fragment, menus, config, created_at, updated_at)
      SELECT name, enabled, version, base, entrypoint, dependencies,
             optional_dependencies, fragment, menus, config, created_at, updated_at
      FROM plugins_old
    `);

    database.run("DROP TABLE plugins_old");
    logger.info("Migration complete");
  } else if (tableInfo.length === 0) {
    // Fresh install: create new schema
    database.run(`
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

  // Drop old tables if they exist (migration from 3-table schema)
  database.run("DROP TABLE IF EXISTS plugin_versions");
  database.run("DROP TABLE IF EXISTS plugin_config");
}

/**
 * Get the runtime database instance
 * Initializes the database on first call
 */
export function getDatabase(): Database {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

/**
 * Close the database connection
 * Call this during shutdown
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
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
export function seedPluginFromManifest(manifest: PluginManifest): void {
  const database = getDatabase();

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
  const existing = database.query("SELECT name, config FROM plugins WHERE name = ?").get(name) as {
    config: string;
    name: string;
  } | null;

  if (!existing) {
    // INSERT: New plugin - use manifest values including enabled and config
    database.run(
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
function getPluginRow(name: string): PluginRow | null {
  const database = getDatabase();
  return database.query("SELECT * FROM plugins WHERE name = ?").get(name) as PluginRow | null;
}

/**
 * Check if a plugin is enabled
 * Returns false if plugin is not in the database or is disabled
 */
export function isPluginEnabled(name: string): boolean {
  const row = getPluginRow(name);
  return row?.enabled === 1;
}

/**
 * Enable a plugin
 */
export function enablePlugin(name: string): void {
  const database = getDatabase();
  const existing = getPluginRow(name);

  if (!existing) {
    // Plugin not in DB - can't enable something that wasn't seeded
    throw new Error(`Plugin "${name}" not found in database. Deploy the plugin first.`);
  }

  database.run(`UPDATE plugins SET enabled = 1, updated_at = unixepoch() WHERE name = ?`, [name]);
  logger.info(`Plugin enabled: ${name}`);
}

/**
 * Disable a plugin
 */
export function disablePlugin(name: string): void {
  const database = getDatabase();
  database.run(`UPDATE plugins SET enabled = 0, updated_at = unixepoch() WHERE name = ?`, [name]);
  logger.info(`Plugin disabled: ${name}`);
}

/**
 * Enable a plugin by ID
 */
export function enablePluginById(id: number): PluginData | null {
  const database = getDatabase();
  const existing = database.query("SELECT * FROM plugins WHERE id = ?").get(id) as PluginRow | null;

  if (!existing) {
    return null;
  }

  database.run(`UPDATE plugins SET enabled = 1, updated_at = unixepoch() WHERE id = ?`, [id]);
  logger.info(`Plugin enabled: ${existing.name} (id: ${id})`);

  return getPluginById(id);
}

/**
 * Disable a plugin by ID
 */
export function disablePluginById(id: number): PluginData | null {
  const database = getDatabase();
  const existing = database.query("SELECT * FROM plugins WHERE id = ?").get(id) as PluginRow | null;

  if (!existing) {
    return null;
  }

  database.run(`UPDATE plugins SET enabled = 0, updated_at = unixepoch() WHERE id = ?`, [id]);
  logger.info(`Plugin disabled: ${existing.name} (id: ${id})`);

  return getPluginById(id);
}

/**
 * Remove a plugin by ID
 */
export function removePluginById(id: number): boolean {
  const database = getDatabase();
  const existing = database.query("SELECT name FROM plugins WHERE id = ?").get(id) as {
    name: string;
  } | null;

  if (!existing) {
    return false;
  }

  database.run("DELETE FROM plugins WHERE id = ?", [id]);
  logger.info(`Plugin removed from database: ${existing.name} (id: ${id})`);

  return true;
}

/**
 * Get all enabled plugin names
 */
export function getEnabledPlugins(): string[] {
  const database = getDatabase();
  const rows = database.query("SELECT name FROM plugins WHERE enabled = 1").all() as Array<{
    name: string;
  }>;
  return rows.map((r) => r.name);
}

// ============================================================================
// Plugin Version
// ============================================================================

/**
 * Get the active version for a plugin
 * Returns "latest" if not set
 */
export function getPluginVersion(name: string): string {
  const row = getPluginRow(name);
  return row?.version ?? "latest";
}

/**
 * Set the active version for a plugin
 */
export function setPluginVersion(name: string, version: string): void {
  const database = getDatabase();
  const existing = getPluginRow(name);

  if (!existing) {
    throw new Error(`Plugin "${name}" not found in database`);
  }

  database.run(`UPDATE plugins SET version = ?, updated_at = unixepoch() WHERE name = ?`, [
    version,
    name,
  ]);
  logger.info(`Plugin version set: ${name}@${version}`);
}

/**
 * Reset plugin version to "latest"
 */
export function resetPluginVersion(name: string): void {
  setPluginVersion(name, "latest");
}

// ============================================================================
// Plugin Config (JSON)
// ============================================================================

/**
 * Get all configuration for a plugin
 * Returns parsed JSON object
 */
export function getPluginConfig(name: string): Record<string, unknown> {
  const row = getPluginRow(name);
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
export function getPluginConfigValue(name: string, key: string): unknown {
  const config = getPluginConfig(name);
  return config[key];
}

/**
 * Set a configuration value for a plugin
 * Merges with existing config
 */
export function setPluginConfig(name: string, key: string, value: unknown): void {
  const database = getDatabase();
  const existing = getPluginRow(name);

  if (!existing) {
    throw new Error(`Plugin "${name}" not found in database`);
  }

  const config = getPluginConfig(name);
  config[key] = value;

  database.run(`UPDATE plugins SET config = ?, updated_at = unixepoch() WHERE name = ?`, [
    JSON.stringify(config),
    name,
  ]);
  logger.debug(`Plugin config set: ${name}.${key}`);
}

/**
 * Set all configuration for a plugin (replaces existing)
 */
export function setPluginConfigAll(name: string, config: Record<string, unknown>): void {
  const database = getDatabase();
  const existing = getPluginRow(name);

  if (!existing) {
    throw new Error(`Plugin "${name}" not found in database`);
  }

  database.run(`UPDATE plugins SET config = ?, updated_at = unixepoch() WHERE name = ?`, [
    JSON.stringify(config),
    name,
  ]);
  logger.debug(`Plugin config replaced: ${name}`);
}

/**
 * Delete a configuration key for a plugin
 * If key is not provided, clears all config
 */
export function deletePluginConfig(name: string, key?: string): void {
  const database = getDatabase();

  if (key) {
    const config = getPluginConfig(name);
    delete config[key];
    database.run(`UPDATE plugins SET config = ?, updated_at = unixepoch() WHERE name = ?`, [
      JSON.stringify(config),
      name,
    ]);
    logger.debug(`Plugin config deleted: ${name}.${key}`);
  } else {
    database.run(`UPDATE plugins SET config = '{}', updated_at = unixepoch() WHERE name = ?`, [
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
export function getPlugin(name: string): PluginData | null {
  const row = getPluginRow(name);
  return row ? rowToPluginData(row) : null;
}

/**
 * Get a plugin by its database ID
 */
export function getPluginById(id: number): PluginData | null {
  const database = getDatabase();
  const row = database.query("SELECT * FROM plugins WHERE id = ?").get(id) as PluginRow | null;
  return row ? rowToPluginData(row) : null;
}

/**
 * Get all plugins with their full state
 */
export function getAllPlugins(): PluginData[] {
  const database = getDatabase();
  const rows = database.query("SELECT * FROM plugins ORDER BY name").all() as PluginRow[];
  return rows.map(rowToPluginData);
}

/**
 * Remove a plugin from the database completely
 */
export function removePluginFromDb(name: string): void {
  const database = getDatabase();
  database.run("DELETE FROM plugins WHERE name = ?", [name]);
  logger.info(`Plugin removed from database: ${name}`);
}
