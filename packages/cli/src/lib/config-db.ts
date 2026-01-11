import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Server configuration stored in SQLite
 */
export interface ServerConfig {
  createdAt: number;
  id: number;
  insecure: boolean;
  lastUsedAt: number | null;
  name: string;
  token: string | null;
  url: string;
}

/**
 * Data for creating/updating a server
 */
export interface ServerData {
  insecure?: boolean;
  name: string;
  token?: string | null;
  url: string;
}

const CONFIG_DIR = join(homedir(), ".buntime");
const DB_PATH = join(CONFIG_DIR, "config.db");

let database: Database | null = null;

/**
 * Get or create the database connection
 */
function getDb(): Database {
  if (database) return database;

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  database = new Database(DB_PATH);
  initSchema(database);

  return database;
}

/**
 * Initialize database schema
 */
function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS servers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      url          TEXT NOT NULL UNIQUE,
      token        TEXT,
      insecure     INTEGER DEFAULT 0,
      last_used_at INTEGER,
      created_at   INTEGER DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

/**
 * Get all saved servers ordered by last used
 */
export function getServers(): ServerConfig[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT id, name, url, token, insecure, last_used_at, created_at
       FROM servers
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
    )
    .all() as Array<{
    created_at: number;
    id: number;
    insecure: number;
    last_used_at: number | null;
    name: string;
    token: string | null;
    url: string;
  }>;

  return rows.map((row) => ({
    createdAt: row.created_at,
    id: row.id,
    insecure: row.insecure === 1,
    lastUsedAt: row.last_used_at,
    name: row.name,
    token: row.token,
    url: row.url,
  }));
}

/**
 * Get a server by ID
 */
export function getServerById(id: number): ServerConfig | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT id, name, url, token, insecure, last_used_at, created_at
       FROM servers WHERE id = ?`,
    )
    .get(id) as {
    created_at: number;
    id: number;
    insecure: number;
    last_used_at: number | null;
    name: string;
    token: string | null;
    url: string;
  } | null;

  if (!row) return null;

  return {
    createdAt: row.created_at,
    id: row.id,
    insecure: row.insecure === 1,
    lastUsedAt: row.last_used_at,
    name: row.name,
    token: row.token,
    url: row.url,
  };
}

/**
 * Get a server by URL
 */
export function getServerByUrl(url: string): ServerConfig | null {
  const db = getDb();
  const row = db
    .query(
      `SELECT id, name, url, token, insecure, last_used_at, created_at
       FROM servers WHERE url = ?`,
    )
    .get(url) as {
    created_at: number;
    id: number;
    insecure: number;
    last_used_at: number | null;
    name: string;
    token: string | null;
    url: string;
  } | null;

  if (!row) return null;

  return {
    createdAt: row.created_at,
    id: row.id,
    insecure: row.insecure === 1,
    lastUsedAt: row.last_used_at,
    name: row.name,
    token: row.token,
    url: row.url,
  };
}

/**
 * Add a new server
 */
export function addServer(data: ServerData): ServerConfig {
  const db = getDb();

  db.run(
    `INSERT INTO servers (name, url, token, insecure, last_used_at)
     VALUES (?, ?, ?, ?, unixepoch())`,
    [data.name, data.url, data.token ?? null, data.insecure ? 1 : 0],
  );

  return getServerByUrl(data.url)!;
}

/**
 * Update an existing server
 */
export function updateServer(id: number, data: Partial<ServerData>): ServerConfig | null {
  const db = getDb();
  const existing = getServerById(id);
  if (!existing) return null;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.name !== undefined) {
    updates.push("name = ?");
    values.push(data.name);
  }
  if (data.url !== undefined) {
    updates.push("url = ?");
    values.push(data.url);
  }
  if (data.token !== undefined) {
    updates.push("token = ?");
    values.push(data.token);
  }
  if (data.insecure !== undefined) {
    updates.push("insecure = ?");
    values.push(data.insecure ? 1 : 0);
  }

  if (updates.length === 0) return existing;

  values.push(id);
  db.run(`UPDATE servers SET ${updates.join(", ")} WHERE id = ?`, values);

  return getServerById(id);
}

/**
 * Update last used timestamp for a server
 */
export function touchServer(id: number): void {
  const db = getDb();
  db.run(`UPDATE servers SET last_used_at = unixepoch() WHERE id = ?`, [id]);
}

/**
 * Delete a server
 */
export function deleteServer(id: number): boolean {
  const db = getDb();
  const result = db.run(`DELETE FROM servers WHERE id = ?`, [id]);
  return result.changes > 0;
}

/**
 * Get a config value
 */
export function getConfig(key: string): string | null {
  const db = getDb();
  const row = db.query(`SELECT value FROM config WHERE key = ?`).get(key) as {
    value: string;
  } | null;
  return row?.value ?? null;
}

/**
 * Set a config value
 */
export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.run(
    `INSERT INTO config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/**
 * Delete a config value
 */
export function deleteConfig(key: string): boolean {
  const db = getDb();
  const result = db.run(`DELETE FROM config WHERE key = ?`, [key]);
  return result.changes > 0;
}

/**
 * Get the last used server ID
 */
export function getLastServerId(): number | null {
  const value = getConfig("last_server_id");
  return value ? Number.parseInt(value, 10) : null;
}

/**
 * Set the last used server ID
 */
export function setLastServerId(id: number): void {
  setConfig("last_server_id", String(id));
}

/**
 * Reset all configuration (delete database file)
 */
export function resetAll(): void {
  if (database) {
    database.close();
    database = null;
  }

  const fs = require("node:fs");
  if (existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (database) {
    database.close();
    database = null;
  }
}

/**
 * Get database path for display
 */
export function getDbPath(): string {
  return DB_PATH;
}
