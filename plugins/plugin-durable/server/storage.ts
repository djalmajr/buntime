import type {
  DurableObjectTransaction,
  DurableObjectStorage as IStorage,
  ListOptions,
} from "@buntime/durable";
import type { DatabaseAdapter } from "@buntime/plugin-database";

/**
 * Initialize the database schema
 */
export async function initDatabase(adapter: DatabaseAdapter): Promise<void> {
  await adapter.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS durable_objects (
        id TEXT PRIMARY KEY,
        class_name TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        last_active_at INTEGER
      )`,
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS object_storage (
        object_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value BLOB,
        PRIMARY KEY (object_id, key),
        FOREIGN KEY (object_id) REFERENCES durable_objects(id) ON DELETE CASCADE
      )`,
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_storage_prefix
            ON object_storage(object_id, key)`,
    },
  ]);
}

function serialize(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function deserialize<T>(data: unknown): T | undefined {
  if (!data) return undefined;
  if (data instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(data)) as T;
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as T;
  }
  return undefined;
}

/**
 * Storage implementation backed by DatabaseAdapter
 */
export class DurableObjectStorage implements IStorage {
  constructor(
    private adapter: DatabaseAdapter,
    private objectId: string,
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(keyOrKeys)) {
      if (keyOrKeys.length === 0) return new Map();

      const placeholders = keyOrKeys.map(() => "?").join(", ");
      const rows = await this.adapter.execute<{ key: string; value: unknown }>(
        `SELECT key, value FROM object_storage
         WHERE object_id = ? AND key IN (${placeholders})`,
        [this.objectId, ...keyOrKeys],
      );

      const map = new Map<string, T>();
      for (const row of rows) {
        const value = deserialize<T>(row.value);
        if (value !== undefined) {
          map.set(row.key, value);
        }
      }
      return map;
    }

    const row = await this.adapter.executeOne<{ value: unknown }>(
      "SELECT value FROM object_storage WHERE object_id = ? AND key = ?",
      [this.objectId, keyOrKeys],
    );

    if (!row) return undefined;
    return deserialize<T>(row.value);
  }

  async put<T>(key: string, value: T): Promise<void>;
  async put<T>(entries: Record<string, T>): Promise<void>;
  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    const entries =
      typeof keyOrEntries === "string" ? { [keyOrEntries]: value as T } : keyOrEntries;

    const batch = Object.entries(entries).map(([k, v]) => ({
      sql: `INSERT OR REPLACE INTO object_storage (object_id, key, value)
            VALUES (?, ?, ?)`,
      args: [this.objectId, k, serialize(v)],
    }));

    await this.adapter.batch(batch);
  }

  async delete(key: string): Promise<boolean>;
  async delete(keys: string[]): Promise<number>;
  async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    if (keys.length === 0) return Array.isArray(keyOrKeys) ? 0 : false;

    // Check existing keys before delete (since adapter doesn't return rowsAffected)
    const placeholders = keys.map(() => "?").join(", ");
    const existing = await this.adapter.execute<{ key: string }>(
      `SELECT key FROM object_storage WHERE object_id = ? AND key IN (${placeholders})`,
      [this.objectId, ...keys],
    );
    const existingCount = existing.length;

    if (existingCount === 0) {
      return Array.isArray(keyOrKeys) ? 0 : false;
    }

    await this.adapter.execute(
      `DELETE FROM object_storage WHERE object_id = ? AND key IN (${placeholders})`,
      [this.objectId, ...keys],
    );

    return Array.isArray(keyOrKeys) ? existingCount : existingCount > 0;
  }

  async list<T = unknown>(options?: ListOptions): Promise<Map<string, T>> {
    const { prefix = "", start, end, limit = 1000, reverse = false } = options ?? {};

    let sql = "SELECT key, value FROM object_storage WHERE object_id = ?";
    const args: (string | number)[] = [this.objectId];

    if (prefix) {
      sql += " AND key LIKE ?";
      args.push(`${prefix}%`);
    }
    if (start) {
      sql += " AND key >= ?";
      args.push(start);
    }
    if (end) {
      sql += " AND key < ?";
      args.push(end);
    }

    sql += ` ORDER BY key ${reverse ? "DESC" : "ASC"} LIMIT ?`;
    args.push(limit);

    const rows = await this.adapter.execute<{ key: string; value: unknown }>(sql, args);

    const map = new Map<string, T>();
    for (const row of rows) {
      const value = deserialize<T>(row.value);
      if (value !== undefined) {
        map.set(row.key, value);
      }
    }
    return map;
  }

  async transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
    // Use adapter's transaction support
    const txn = new InMemoryTransaction(this);
    const result = await closure(txn);
    await txn.commit();
    return result;
  }
}

/**
 * Simple in-memory transaction that batches operations
 */
class InMemoryTransaction implements DurableObjectTransaction {
  private operations: Array<{ type: "put" | "delete"; key: string; value?: unknown }> = [];
  private cache = new Map<string, unknown>();
  private deleted = new Set<string>();
  private rolledBack = false;

  constructor(private storage: DurableObjectStorage) {}

  async get<T = unknown>(key: string): Promise<T | undefined>;
  async get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  async get<T = unknown>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (this.rolledBack) throw new Error("Transaction rolled back");

    if (Array.isArray(keyOrKeys)) {
      const result = new Map<string, T>();
      for (const key of keyOrKeys) {
        if (this.deleted.has(key)) continue;
        if (this.cache.has(key)) {
          result.set(key, this.cache.get(key) as T);
        } else {
          const value = await this.storage.get<T>(key);
          if (value !== undefined) result.set(key, value);
        }
      }
      return result;
    }

    if (this.deleted.has(keyOrKeys)) return undefined;
    if (this.cache.has(keyOrKeys)) return this.cache.get(keyOrKeys) as T;
    return this.storage.get<T>(keyOrKeys);
  }

  put<T>(key: string, value: T): void;
  put<T>(entries: Record<string, T>): void;
  put<T>(keyOrEntries: string | Record<string, T>, value?: T): void {
    if (this.rolledBack) throw new Error("Transaction rolled back");

    const entries =
      typeof keyOrEntries === "string" ? { [keyOrEntries]: value as T } : keyOrEntries;

    for (const [k, v] of Object.entries(entries)) {
      this.cache.set(k, v);
      this.deleted.delete(k);
      this.operations.push({ type: "put", key: k, value: v });
    }
  }

  delete(key: string): void;
  delete(keys: string[]): void;
  delete(keyOrKeys: string | string[]): void {
    if (this.rolledBack) throw new Error("Transaction rolled back");

    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    for (const key of keys) {
      this.cache.delete(key);
      this.deleted.add(key);
      this.operations.push({ type: "delete", key });
    }
  }

  rollback(): void {
    this.rolledBack = true;
    this.operations = [];
    this.cache.clear();
    this.deleted.clear();
  }

  async commit(): Promise<void> {
    if (this.rolledBack) return;

    // Apply puts
    const puts: Record<string, unknown> = {};
    const deletes: string[] = [];

    for (const op of this.operations) {
      if (op.type === "put") {
        puts[op.key] = op.value;
        const idx = deletes.indexOf(op.key);
        if (idx >= 0) deletes.splice(idx, 1);
      } else {
        deletes.push(op.key);
        delete puts[op.key];
      }
    }

    if (Object.keys(puts).length > 0) {
      await this.storage.put(puts);
    }
    if (deletes.length > 0) {
      await this.storage.delete(deletes);
    }
  }
}
