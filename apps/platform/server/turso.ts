/**
 * Tenant registry, persisted with **`bun:sqlite`** (Bun built-in). The platform
 * app is the sole writer; reads serve the shell's config/catalog endpoints.
 *
 * Why bun:sqlite and not `@buntime/shared/turso` (openTurso): a worker bundled by
 * `createAppBuilder` cannot use `@tursodatabase` — Bun inlines its JS but the
 * native NAPI addon does not couple, so `connect()` throws `connectAsync is not a
 * function`. `bun:sqlite` is a built-in (resolved at runtime, never bundled) and
 * the file is SQLite/Turso-compatible. Single-node local mode is durable on the
 * runtime's per-pod state PVC; no push/pull (no multi-pod sync here).
 * See memory: notes/worker-turso-bundling-gotcha.md.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CatalogApp, TenantRecord, TenantStatus } from "./types.ts";

const DEFAULT_DIR = "./.cache/turso";

export interface TenantStoreOptions {
  /** Directory for the SQLite file. Default: `RUNTIME_STATE_DIR/turso` (set by caller) or `./.cache/turso`. */
  dir?: string;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tenants (
    host         TEXT PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    realm        TEXT NOT NULL,
    client_id    TEXT NOT NULL,
    url          TEXT NOT NULL,
    catalog_json TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
`;

interface TenantRow {
  host: string;
  slug: string;
  realm: string;
  client_id: string;
  url: string;
  catalog_json: string;
  status: string;
  created_at: number;
}

function parseCatalog(raw: string): CatalogApp[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CatalogApp[]) : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: TenantRow): TenantRecord {
  return {
    host: row.host,
    slug: row.slug,
    realm: row.realm,
    clientId: row.client_id,
    url: row.url,
    catalog: parseCatalog(row.catalog_json),
    status: row.status as TenantStatus,
    createdAt: row.created_at,
  };
}

/** SQLite-backed tenant registry. Open with {@link TenantStore.open}. */
export class TenantStore {
  private constructor(private readonly db: Database) {}

  /** Open the registry database and apply the schema. */
  static async open(opts?: TenantStoreOptions): Promise<TenantStore> {
    const dir = opts?.dir ?? DEFAULT_DIR;
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, "tenants.db"), { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA_SQL);
    return new TenantStore(db);
  }

  async list(): Promise<TenantRecord[]> {
    const rows = this.db
      .query("SELECT * FROM tenants ORDER BY created_at DESC")
      .all() as TenantRow[];
    return rows.map(rowToRecord);
  }

  async getByHost(host: string): Promise<TenantRecord | null> {
    const row = this.db.query("SELECT * FROM tenants WHERE host = ?").get(host) as TenantRow | null;
    return row ? rowToRecord(row) : null;
  }

  async getBySlug(slug: string): Promise<TenantRecord | null> {
    const row = this.db.query("SELECT * FROM tenants WHERE slug = ?").get(slug) as TenantRow | null;
    return row ? rowToRecord(row) : null;
  }

  /** Insert or replace a tenant (idempotent on host). */
  async upsert(record: TenantRecord): Promise<void> {
    this.db
      .query(`
        INSERT INTO tenants (host, slug, realm, client_id, url, catalog_json, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host) DO UPDATE SET
          slug = excluded.slug,
          realm = excluded.realm,
          client_id = excluded.client_id,
          url = excluded.url,
          catalog_json = excluded.catalog_json,
          status = excluded.status
      `)
      .run(
        record.host,
        record.slug,
        record.realm,
        record.clientId,
        record.url,
        JSON.stringify(record.catalog),
        record.status,
        record.createdAt,
      );
  }

  async setStatus(slug: string, status: TenantStatus): Promise<void> {
    this.db.query("UPDATE tenants SET status = ? WHERE slug = ?").run(status, slug);
  }

  async removeBySlug(slug: string): Promise<void> {
    this.db.query("DELETE FROM tenants WHERE slug = ?").run(slug);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
