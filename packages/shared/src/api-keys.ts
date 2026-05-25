/**
 * @module
 * Runtime API key store used by the cpanel and the shared API-key middleware.
 *
 * The store persists keys in a local **Turso DB** (the Rust rewrite of SQLite
 * with MVCC, embedded replicas, and multi-database support) via Bun's bundled
 * `@tursodatabase/database` (local mode) and `@tursodatabase/sync` (embedded
 * replica with sync to a Turso server primary).
 *
 * Bootstrap independence: Turso DB is a bundled dependency of `@buntime/shared`
 * (no plugin required, no external DB needed for the default `local` mode).
 * The store loads before any plugin and stays available on a fresh deploy.
 *
 * Two modes:
 *
 * 1. **`local`** (default, single-pod): a standalone Turso DB file at
 *    `<stateDir>/api-keys.db`. MVCC journal. Self-contained.
 * 2. **`sync`** (multi-pod): an embedded replica at `<stateDir>/api-keys.db`
 *    that pulls from / pushes to a remote Turso server primary
 *    (`libsql://<primary>:<port>/api-keys`). Reads stay local (O(log n) +
 *    in-memory cache); writes are serialized at the primary via MVCC.
 *
 * Storage layout: `<stateDir>/api-keys.db`. Turso DB files are binarily
 * SQLite-compatible — any existing `bun:sqlite`-format `api-keys.db` opens
 * directly without migration. Pre-2026-05-20 the store used JSON; legacy
 * files are migrated to the DB on first boot and renamed to `*.migrated`.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { connect as connectLocal } from "@tursodatabase/database";
import { connect as connectSync } from "@tursodatabase/sync";
import { NotFoundError, ValidationError } from "./errors";

export const KEY_ROLES = ["admin", "editor", "viewer", "custom"] as const;

export type KeyRole = (typeof KEY_ROLES)[number];

/**
 * Worker permissions cover the lifecycle of a deployed serverless artifact:
 * - `workers:read`   — list installed workers (their dirs, versions, source)
 * - `workers:install`— upload a new worker archive (.tgz/.zip) into a workerDir
 * - `workers:remove` — delete a worker (or a specific version) from a workerDir
 * - `workers:restart`— recycle a running worker process (reserved for a future
 *                      `/api/workers/:name/restart` endpoint; no consumer yet)
 *
 * Prior to 2026-05-19 these were split between `apps:*` (filesystem ops) and
 * `workers:*` (runtime ops, never implemented). Apps = workers in Buntime —
 * each app is served by a worker in the pool — so the vocabulary collapsed.
 */
export const ALL_PERMISSIONS = [
  "workers:read",
  "workers:install",
  "workers:remove",
  "workers:restart",
  "plugins:read",
  "plugins:install",
  "plugins:remove",
  "plugins:config",
  "keys:read",
  "keys:create",
  "keys:revoke",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

/** Wildcard namespace — grants management access to every namespace. */
export const WILDCARD_NAMESPACE = "*";

export interface ApiKeyInfo {
  createdAt: number;
  createdBy?: number;
  description?: string;
  expiresAt?: number;
  id: number;
  keyPrefix: string;
  lastUsedAt?: number;
  name: string;
  /**
   * Namespaces this key may see/manage (workers + plugins). `["*"]` = all
   * (default, backward-compatible). A specific entry like `@acme` grants
   * `@acme/*` only; unscoped resources require `*`.
   */
  namespaces: string[];
  permissions: Permission[];
  role: KeyRole;
}

export interface ApiKeyPrincipal extends ApiKeyInfo {
  isRoot?: boolean;
}

export interface CreateApiKeyInput {
  description?: string;
  expiresIn?: string;
  name?: string;
  /** Namespaces the key may manage. Defaults to `["*"]` (all). */
  namespaces?: string[];
  permissions?: Permission[];
  role?: KeyRole;
}

export interface CreateApiKeyResult {
  id: number;
  key: string;
  keyPrefix: string;
  name: string;
  role: KeyRole;
}

/** Configuration accepted by `ApiKeyStore.open` and `ApiKeyStore.fromStateDir`. */
export interface AuthDbConfig {
  /** Filesystem path for the Turso DB file (and embedded replica when `mode=sync`). */
  dbPath: string;
  /**
   * `local` keeps the DB self-contained (default, single-pod). `sync` syncs
   * an embedded replica against a remote Turso server primary.
   */
  mode: "local" | "sync";
  /** libsql URL of the Turso server primary. Required when `mode=sync`. */
  syncUrl?: string;
  /** Auth token for the primary. Sent on every sync request. */
  syncAuthToken?: string;
  /** Auto-pull interval in seconds (default `60`). Ignored when `mode=local`. */
  syncIntervalSeconds?: number;
}

const KEY_PREFIX_LENGTH = 12;
const LAST_USED_WRITE_INTERVAL_SECONDS = 60;
const DEFAULT_SYNC_INTERVAL_SECONDS = 60;

const ROLE_PERMISSIONS: Record<Exclude<KeyRole, "custom">, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  editor: [
    "workers:read",
    "workers:install",
    "workers:remove",
    "workers:restart",
    "plugins:read",
    "plugins:install",
    "plugins:remove",
    "plugins:config",
  ],
  viewer: ["workers:read", "plugins:read", "keys:read"],
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function generateKey(): string {
  return `btk_${randomBytes(32).toString("base64url")}`;
}

function normalizeRole(role?: string): KeyRole {
  if (!role) return "editor";
  if ((KEY_ROLES as readonly string[]).includes(role)) return role as KeyRole;
  throw new ValidationError(`Invalid role: ${role}`, "INVALID_KEY_ROLE");
}

function normalizePermissions(role: KeyRole, permissions?: string[]): Permission[] {
  if (role !== "custom") return ROLE_PERMISSIONS[role];

  const selected = permissions ?? [];
  if (selected.length === 0) {
    throw new ValidationError("Custom keys require at least one permission", "MISSING_PERMISSIONS");
  }

  for (const permission of selected) {
    if (!(ALL_PERMISSIONS as readonly string[]).includes(permission)) {
      throw new ValidationError(`Invalid permission: ${permission}`, "INVALID_PERMISSION");
    }
  }

  return [...new Set(selected)] as Permission[];
}

const NAMESPACE_PATTERN = /^@[a-z0-9][a-z0-9._-]*$/i;

/**
 * Normalize a key's namespace list. Empty/undefined → `["*"]` (all). Validates
 * each entry is `*` or an `@scope` token; dedupes. `*` collapses to `["*"]`.
 */
function normalizeNamespaces(namespaces?: string[]): string[] {
  const list = (namespaces ?? []).map((n) => n.trim()).filter(Boolean);
  if (list.length === 0 || list.includes(WILDCARD_NAMESPACE)) return [WILDCARD_NAMESPACE];

  for (const ns of list) {
    if (!NAMESPACE_PATTERN.test(ns)) {
      throw new ValidationError(
        `Invalid namespace: ${ns} (use "*" or "@scope")`,
        "INVALID_NAMESPACE",
      );
    }
  }
  return [...new Set(list)];
}

function parseExpiresAt(expiresIn?: string): number | undefined {
  if (!expiresIn || expiresIn === "never") return undefined;

  const match = expiresIn.match(/^(\d+)(d|w|m|y)$/);
  if (!match) {
    throw new ValidationError(
      "Invalid expiration. Use never, 30d, 90d, or 1y",
      "INVALID_EXPIRATION",
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("Expiration must be greater than zero", "INVALID_EXPIRATION");
  }

  const days =
    unit === "d" ? amount : unit === "w" ? amount * 7 : unit === "m" ? amount * 30 : amount * 365;

  return nowSeconds() + days * 24 * 60 * 60;
}

export function hasPermission(principal: ApiKeyPrincipal, permission: Permission): boolean {
  if (principal.isRoot || principal.role === "admin") return true;
  return principal.permissions.includes(permission);
}

/**
 * The namespace a worker/plugin name belongs to: the `@scope` prefix, or
 * `null` for an unscoped name. Accepts a name (`@scope/app`, `app`) — callers
 * pass the resolved unit name, not a raw path.
 */
export function namespaceOf(name: string): string | null {
  return name.startsWith("@") ? (name.split("/")[0] ?? null) : null;
}

/**
 * Whether a principal may see/manage a resource in namespace `ns` (the result
 * of {@link namespaceOf}). Root and `*` keys access everything; an unscoped
 * resource (`ns === null`) requires `*`; otherwise the namespace must be listed.
 */
export function principalCanAccessNamespace(
  principal: Pick<ApiKeyPrincipal, "isRoot" | "namespaces">,
  ns: string | null,
): boolean {
  if (principal.isRoot) return true;
  const allowed = principal.namespaces ?? [WILDCARD_NAMESPACE];
  if (allowed.includes(WILDCARD_NAMESPACE)) return true;
  if (ns === null) return false;
  return allowed.includes(ns);
}

/** Raw row shape returned by SQL `SELECT * FROM api_keys`. */
interface ApiKeyRow {
  id: number;
  key_hash: string;
  key_prefix: string;
  name: string;
  description: string | null;
  role: string;
  permissions: string;
  namespaces: string | null;
  created_at: number;
  created_by: number | null;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** Parse the namespaces column; missing/empty → `["*"]` (legacy keys = all). */
function parseNamespaces(raw: string | null | undefined): string[] {
  if (!raw) return [WILDCARD_NAMESPACE];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as string[]) : [WILDCARD_NAMESPACE];
  } catch {
    return [WILDCARD_NAMESPACE];
  }
}

function rowToPublic(row: ApiKeyRow): ApiKeyInfo {
  return {
    createdAt: row.created_at,
    ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
    id: row.id,
    keyPrefix: row.key_prefix,
    ...(row.last_used_at !== null ? { lastUsedAt: row.last_used_at } : {}),
    name: row.name,
    namespaces: parseNamespaces(row.namespaces),
    permissions: JSON.parse(row.permissions) as Permission[],
    role: row.role as KeyRole,
  };
}

function isRowActive(row: ApiKeyRow, at = nowSeconds()): boolean {
  return !row.revoked_at && (!row.expires_at || row.expires_at > at);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Schema + legacy JSON migration                                             */
/* ────────────────────────────────────────────────────────────────────────── */

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS api_keys (
    id            INTEGER PRIMARY KEY,
    key_hash      TEXT    NOT NULL UNIQUE,
    key_prefix    TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    description   TEXT,
    role          TEXT    NOT NULL,
    permissions   TEXT    NOT NULL,
    namespaces    TEXT,
    created_at    INTEGER NOT NULL,
    created_by    INTEGER,
    expires_at    INTEGER,
    last_used_at  INTEGER,
    revoked_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_lookup
    ON api_keys(key_hash) WHERE revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_api_keys_expiry
    ON api_keys(expires_at) WHERE revoked_at IS NULL;
`;

interface LegacyStoredKey {
  id: number;
  keyHash: string;
  keyPrefix: string;
  name: string;
  description?: string;
  role: KeyRole;
  permissions: Permission[];
  createdAt: number;
  createdBy?: number;
  expiresAt?: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

interface LegacyKeyStoreFile {
  keys?: LegacyStoredKey[];
  version?: number;
}

/**
 * Turso raw client type — kept loose because the two drivers (local + sync)
 * share the same method surface but ship slightly different concrete types.
 * We only use `exec`, `prepare`, and `close` (plus `pull` from the sync flavor).
 */
interface RawClientLike {
  close(): Promise<void>;
  exec(sql: string): Promise<void>;
  prepare(sql: string): {
    all<T = unknown>(...bind: unknown[]): Promise<T[]>;
    get<T = unknown>(...bind: unknown[]): Promise<T | null>;
    run(...bind: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
  };
}

interface SyncClientLike extends RawClientLike {
  pull(): Promise<boolean>;
  push(): Promise<void>;
}

/**
 * Add the `namespaces` column to a pre-existing `api_keys` table that was
 * created before namespaces existed. Idempotent: checks `PRAGMA table_info`
 * and no-ops when the column is already present (incl. fresh DBs where
 * `SCHEMA_SQL` already created it). Existing rows keep `NULL`, which
 * `parseNamespaces` reads as `["*"]` — so old keys retain full access.
 */
async function migrateAddNamespacesColumn(client: RawClientLike): Promise<void> {
  const cols = await client.prepare("PRAGMA table_info(api_keys)").all<{ name: string }>();
  if (cols.some((c) => c.name === "namespaces")) return;
  await client.exec("ALTER TABLE api_keys ADD COLUMN namespaces TEXT");
}

/**
 * If a legacy JSON store exists in the same directory as the DB file and the
 * DB is empty, migrate every row across in a single transaction and rename
 * the JSON to `<file>.migrated` (kept as defensive backup, never deleted).
 *
 * Idempotent: silently no-ops when there is nothing to migrate or the DB
 * already has rows.
 */
async function migrateLegacyJsonIfPresent(client: RawClientLike, dbPath: string): Promise<void> {
  const legacyPath = join(dirname(dbPath), "api-keys.json");
  if (!existsSync(legacyPath)) return;

  const existing = (await client
    .prepare("SELECT COUNT(*) as count FROM api_keys")
    .get<{ count: number }>()) ?? { count: 0 };
  if (existing.count > 0) return;

  let parsed: LegacyKeyStoreFile;
  try {
    parsed = JSON.parse(readFileSync(legacyPath, "utf8")) as LegacyKeyStoreFile;
  } catch {
    return;
  }

  const keys = Array.isArray(parsed.keys) ? parsed.keys : [];
  if (keys.length === 0) {
    renameSync(legacyPath, `${legacyPath}.migrated`);
    return;
  }

  const insert = client.prepare(`
    INSERT INTO api_keys
      (id, key_hash, key_prefix, name, description, role, permissions, namespaces,
       created_at, created_by, expires_at, last_used_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const key of keys) {
    await insert.run(
      key.id,
      key.keyHash,
      key.keyPrefix,
      key.name,
      key.description ?? null,
      key.role,
      JSON.stringify(key.permissions),
      // Legacy keys predate namespaces → full access.
      JSON.stringify([WILDCARD_NAMESPACE]),
      key.createdAt,
      key.createdBy ?? null,
      key.expiresAt ?? null,
      key.lastUsedAt ?? null,
      key.revokedAt ?? null,
    );
  }

  renameSync(legacyPath, `${legacyPath}.migrated`);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* ApiKeyStore                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Turso DB-backed runtime API key store.
 *
 * Construct via `ApiKeyStore.open(cfg)` (explicit config) or
 * `ApiKeyStore.fromStateDir(stateDir, cfg?)` (config inferred from the
 * conventional `<stateDir>/api-keys.db` layout).
 */
export class ApiKeyStore {
  private readonly client: RawClientLike;
  private readonly mode: "local" | "sync";
  private syncTimer?: ReturnType<typeof setInterval>;
  private writeLock: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(client: RawClientLike, mode: "local" | "sync") {
    this.client = client;
    this.mode = mode;
  }

  /**
   * Internal test seam: construct an ApiKeyStore around a pre-built client
   * without opening a real connection. Used by unit tests that need to
   * exercise the sync-mode codepaths (`pushIfSync`, transaction downgrade)
   * without standing up a real turso-server.
   *
   * The schema is applied unconditionally — callers can pass an in-memory
   * Turso DB client paired with `mode: "sync"` to validate sync semantics.
   *
   * @internal — production code must use `open()` or `fromStateDir()`.
   */
  static async __forTests(client: RawClientLike, mode: "local" | "sync"): Promise<ApiKeyStore> {
    await client.exec(SCHEMA_SQL);
    await migrateAddNamespacesColumn(client);
    return new ApiKeyStore(client, mode);
  }

  /**
   * Open a Turso DB-backed store at the given path/config. Creates the file,
   * applies the schema, enables MVCC journal, migrates any legacy JSON, and
   * starts the sync timer when `mode=sync`.
   */
  static async open(cfg: AuthDbConfig): Promise<ApiKeyStore> {
    if (cfg.mode === "sync" && !cfg.syncUrl?.trim()) {
      throw new ValidationError("Auth DB sync mode requires syncUrl", "AUTH_DB_SYNC_URL_REQUIRED");
    }

    mkdirSync(dirname(cfg.dbPath), { recursive: true });

    let client: RawClientLike;
    let syncClient: SyncClientLike | undefined;

    if (cfg.mode === "sync") {
      const c = (await connectSync({
        authToken: cfg.syncAuthToken,
        path: cfg.dbPath,
        url: cfg.syncUrl,
      } as unknown as Parameters<typeof connectSync>[0])) as unknown as SyncClientLike;
      syncClient = c;
      client = c;
    } else {
      client = (await connectLocal(cfg.dbPath)) as unknown as RawClientLike;
    }

    // MVCC journal mode only applies to local (standalone) databases — sync
    // embedded replicas have CDC active for sync, and `tursodb` currently
    // rejects `PRAGMA journal_mode = mvcc` while CDC is enabled with
    // "cannot enable MVCC while CDC is active". The primary itself decides
    // the journal mode for sync clients.
    if (cfg.mode === "local") {
      await client.exec("PRAGMA journal_mode = mvcc");
    }
    await client.exec(SCHEMA_SQL);
    await migrateAddNamespacesColumn(client);
    await migrateLegacyJsonIfPresent(client, cfg.dbPath);

    const store = new ApiKeyStore(client, cfg.mode);

    if (syncClient) {
      const intervalSeconds = cfg.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS;
      if (intervalSeconds > 0) {
        store.syncTimer = setInterval(() => {
          syncClient.pull().catch(() => {
            // Best-effort: a missed pull will be retried on the next tick.
          });
        }, intervalSeconds * 1000);
      }
    }

    return store;
  }

  /**
   * Open a store with the conventional `<stateDir>/api-keys.db` path,
   * merging any partial config provided.
   */
  static async fromStateDir(
    stateDir: string,
    cfg?: Partial<Omit<AuthDbConfig, "dbPath">>,
  ): Promise<ApiKeyStore> {
    return ApiKeyStore.open({
      dbPath: join(stateDir, "api-keys.db"),
      mode: cfg?.mode ?? "local",
      syncUrl: cfg?.syncUrl,
      syncAuthToken: cfg?.syncAuthToken,
      syncIntervalSeconds: cfg?.syncIntervalSeconds,
    });
  }

  /** Close the underlying connection (and stop the sync timer). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.syncTimer) clearInterval(this.syncTimer);
    await this.client.close();
  }

  async list(): Promise<ApiKeyInfo[]> {
    const rows = await this.client
      .prepare("SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC")
      .all<ApiKeyRow>();
    return rows.map(rowToPublic);
  }

  async hasKeys(): Promise<boolean> {
    const row = await this.client
      .prepare("SELECT COUNT(*) as count FROM api_keys WHERE revoked_at IS NULL")
      .get<{ count: number }>();
    return (row?.count ?? 0) > 0;
  }

  async verify(rawKey: string | undefined): Promise<ApiKeyPrincipal | null> {
    if (!rawKey) return null;

    const keyHash = hashKey(rawKey);
    const row = await this.client
      .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
      .get<ApiKeyRow>(keyHash);
    if (!row) return null;

    // Constant-time recheck against any future change in indexed lookup.
    if (!hashesEqual(row.key_hash, keyHash)) return null;

    const at = nowSeconds();
    if (!isRowActive(row, at)) return null;

    if (!row.last_used_at || at - row.last_used_at >= LAST_USED_WRITE_INTERVAL_SECONDS) {
      await this.locked(async () => {
        await this.client
          .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
          .run(at, row.id);
      });
    }

    return rowToPublic({ ...row, last_used_at: at });
  }

  async create(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    return this.locked(async () => {
      const name = input.name?.trim();
      if (!name) {
        throw new ValidationError("Key name is required", "MISSING_KEY_NAME");
      }

      const role = normalizeRole(input.role);
      const permissions = normalizePermissions(role, input.permissions);
      const namespaces = normalizeNamespaces(input.namespaces);
      const expiresAt = parseExpiresAt(input.expiresIn);
      const description = input.description?.trim() || null;
      const key = generateKey();
      const at = nowSeconds();
      const keyPrefix = key.slice(0, KEY_PREFIX_LENGTH);

      const inserted = await this.client
        .prepare(`
          INSERT INTO api_keys
            (key_hash, key_prefix, name, description, role, permissions, namespaces,
             created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `)
        .get<{ id: number }>(
          hashKey(key),
          keyPrefix,
          name,
          description,
          role,
          JSON.stringify(permissions),
          JSON.stringify(namespaces),
          at,
          expiresAt ?? null,
        );

      if (!inserted) {
        throw new Error("Failed to insert API key");
      }

      return {
        id: inserted.id,
        key,
        keyPrefix,
        name,
        role,
      };
    }).then(async (result) => {
      // Sync mode: push the local change to the primary so other replicas can
      // pull it on their next interval. Best-effort.
      await this.pushIfSync();
      return result;
    });
  }

  async revoke(id: number): Promise<void> {
    await this.locked(async () => {
      const row = await this.client
        .prepare("SELECT id, revoked_at FROM api_keys WHERE id = ?")
        .get<Pick<ApiKeyRow, "id" | "revoked_at">>(id);
      if (!row || row.revoked_at) {
        throw new NotFoundError(`API key not found: ${id}`, "API_KEY_NOT_FOUND");
      }
      await this.client
        .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?")
        .run(nowSeconds(), id);
    });
    await this.pushIfSync();
  }

  /**
   * Push pending local changes to the primary when running in sync mode.
   * Best-effort: if the primary is unreachable, the change stays in the local
   * replica and will be pushed on the next call.
   *
   * Without this explicit push after each write, `@tursodatabase/sync` keeps
   * the change local — the periodic timer only pulls — and other replicas
   * never see the write. Validated end-to-end against `tursodb --sync-server`
   * v0.6.0 in K8s multi-pod (3 replicas).
   */
  private async pushIfSync(): Promise<void> {
    if (this.mode !== "sync") return;
    const sync = this.client as RawClientLike & Partial<SyncClientLike>;
    if (typeof sync.push !== "function") return;
    try {
      await sync.push();
    } catch {
      // Best-effort: leave the change in the local replica.
    }
  }

  /**
   * Single-process write serialization. Turso DB already locks writes at the
   * file level (MVCC), but JS-side ordering avoids interleaved RETURNING ids
   * between a long-running `create` and a follow-up call.
   */
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeLock;
    let release = () => {};
    this.writeLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
