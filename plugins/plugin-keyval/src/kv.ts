import type { DatabaseAdapter } from "@buntime/plugin-database";
import type { PluginLogger } from "@buntime/shared/types";
import { AtomicOperation } from "./atomic";
import {
  decodeKey,
  deserializeValue,
  encodeKey,
  encodePrefixRange,
  serializeValue,
} from "./encoding";
import { KvFts } from "./fts";
import { KvMetrics } from "./metrics";
import { KvQueue, type KvQueueCleanupConfig } from "./queue";
import { KvTransaction } from "./transaction";
import {
  createCommitVersionstamp,
  type KvCommitVersionstamp,
  type KvDeleteOptions,
  type KvEntry,
  type KvKey,
  type KvListOptions,
  type KvPaginateOptions,
  type KvPaginateResult,
  type KvSetOptions,
  type KvTransactionError,
  type KvTransactionOptions,
  type KvTransactionResult,
  type KvTriggerConfig,
  type KvTriggerEvent,
  type KvTriggerEventType,
} from "./types";
import { whereToSql } from "./where-to-sql";

/**
 * Options for Kv constructor
 */
export interface KvOptions {
  /** Logger instance */
  logger?: PluginLogger;

  /** Enable persistent metrics (stored in database) */
  persistentMetrics?: boolean;

  /** Metrics flush interval in ms */
  metricsFlushInterval?: number;

  /** Queue cleanup configuration */
  queueCleanup?: KvQueueCleanupConfig;
}

/**
 * Key-Value store implementation backed by DatabaseAdapter
 * API inspired by Deno KV
 */
export class Kv {
  private cleanupInterval: Timer | null = null;
  private _fts: KvFts | null = null;
  private _metrics: KvMetrics | null = null;
  private _queue: KvQueue | null = null;
  private readonly logger: PluginLogger | undefined;
  private readonly kvOptions: KvOptions | undefined;
  private readonly triggers: Map<string, KvTriggerConfig> = new Map();

  constructor(
    private adapter: DatabaseAdapter,
    options?: KvOptions,
  ) {
    this.logger = options?.logger;
    this.kvOptions = options;
    this.startCleanup();
  }

  /**
   * Get the underlying database adapter
   * @internal
   */
  getAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  /**
   * Get the metrics collector (created lazily)
   */
  get metrics(): KvMetrics {
    if (!this._metrics) {
      this._metrics = new KvMetrics(
        this.kvOptions?.persistentMetrics
          ? {
              adapter: this.adapter,
              flushInterval: this.kvOptions?.metricsFlushInterval,
            }
          : undefined,
      );
    }
    return this._metrics;
  }

  /**
   * Get the queue instance (created lazily)
   */
  get queue(): KvQueue {
    return (this._queue ||= new KvQueue(this.adapter, this, this.kvOptions?.queueCleanup));
  }

  /**
   * Get the FTS instance (created lazily)
   */
  get fts(): KvFts {
    return (this._fts ||= new KvFts(this.adapter));
  }

  /**
   * Get the logger instance (for internal use by KvQueue)
   * @internal
   */
  getLogger(): PluginLogger | undefined {
    return this.logger;
  }

  /**
   * Add a trigger that fires when keys matching the prefix are modified
   * @returns Unsubscribe function to remove the trigger
   */
  addTrigger<T = unknown>(config: KvTriggerConfig<T>): () => void {
    const id = crypto.randomUUID();
    this.triggers.set(id, config as KvTriggerConfig);
    return () => {
      this.triggers.delete(id);
    };
  }

  /**
   * Fire triggers for a key modification
   * @internal
   */
  async fireTriggers(
    type: KvTriggerEventType,
    key: KvKey,
    value?: unknown,
    versionstamp?: string,
  ): Promise<void> {
    for (const trigger of this.triggers.values()) {
      if (!trigger.events.includes(type)) continue;
      if (!this.keyMatchesPrefix(key, trigger.prefix)) continue;

      const event: KvTriggerEvent = {
        key,
        type,
        value,
        versionstamp: versionstamp ?? "",
      };

      try {
        await trigger.handler(event);
      } catch (err) {
        this.logger?.error("Trigger handler failed", {
          error: err instanceof Error ? err.message : String(err),
          key,
          type,
        });
      }
    }
  }

  /**
   * Check if a key matches a prefix
   */
  private keyMatchesPrefix(key: KvKey, prefix: KvKey): boolean {
    if (prefix.length === 0) return true;
    if (prefix.length > key.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (key[i] !== prefix[i]) return false;
    }
    return true;
  }

  /**
   * Check if keys is a nested array (KvKey[]) vs single key (KvKey)
   */
  private isNestedKeyArray(keys: KvKey | KvKey[]): boolean {
    return Array.isArray(keys) && keys.length > 0 && Array.isArray(keys[0]);
  }

  /**
   * Get value(s) by key(s)
   */
  async get<T = unknown>(keys: []): Promise<KvEntry<T>[]>;
  async get<T = unknown>(keys: KvKey): Promise<KvEntry<T>>;
  async get<T = unknown>(keys: KvKey[]): Promise<KvEntry<T>[]>;
  async get<T = unknown>(keys: KvKey | KvKey[]): Promise<KvEntry<T> | KvEntry<T>[]> {
    // Empty array - return empty result
    if (Array.isArray(keys) && keys.length === 0) {
      return [];
    }

    // Multiple keys - batch request
    if (this.isNestedKeyArray(keys)) {
      return this.getBatch<T>(keys as KvKey[]);
    }

    // Single key
    return this.getSingle<T>(keys as KvKey);
  }

  /**
   * Get a single value by key (internal)
   */
  private async getSingle<T = unknown>(key: KvKey): Promise<KvEntry<T>> {
    const start = performance.now();
    let error = false;

    try {
      const encodedKey = encodeKey(key);

      const rows = await this.adapter.execute<{
        key: Uint8Array;
        value: unknown;
        versionstamp: string;
      }>(
        `SELECT key, value, versionstamp FROM kv_entries
         WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())`,
        [encodedKey],
      );

      const row = rows[0];
      if (!row) {
        return { key, value: null, versionstamp: null };
      }

      return {
        key,
        value: deserializeValue<T>(row.value),
        versionstamp: row.versionstamp,
      };
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("get", performance.now() - start, error);
    }
  }

  /**
   * Get multiple values by keys (internal)
   */
  private async getBatch<T = unknown>(keys: KvKey[]): Promise<KvEntry<T>[]> {
    if (keys.length === 0) return [];

    const start = performance.now();
    let error = false;

    try {
      const encodedKeys = keys.map(encodeKey);
      const placeholders = encodedKeys.map(() => "?").join(", ");

      const rows = await this.adapter.execute<{
        key: Uint8Array | ArrayBuffer;
        value: unknown;
        versionstamp: string;
      }>(
        `SELECT key, value, versionstamp FROM kv_entries
         WHERE key IN (${placeholders}) AND (expires_at IS NULL OR expires_at > unixepoch())`,
        encodedKeys,
      );

      // Create a map of results
      const resultMap = new Map<string, { value: unknown; versionstamp: string }>();
      for (const row of rows) {
        const keyBytes =
          row.key instanceof Uint8Array ? row.key : new Uint8Array(row.key as ArrayBuffer);
        const keyHex = Buffer.from(keyBytes).toString("hex");
        resultMap.set(keyHex, {
          value: row.value,
          versionstamp: row.versionstamp,
        });
      }

      // Return in the same order as requested keys
      return keys.map((key) => {
        const keyHex = Buffer.from(encodeKey(key)).toString("hex");
        const row = resultMap.get(keyHex);

        if (!row) {
          return { key, value: null, versionstamp: null };
        }

        return {
          key,
          value: deserializeValue<T>(row.value),
          versionstamp: row.versionstamp,
        };
      });
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("get", performance.now() - start, error);
    }
  }

  /**
   * Set a key-value pair
   */
  async set<T>(
    key: KvKey,
    value: T,
    options?: KvSetOptions,
  ): Promise<{ ok: true; versionstamp: string }> {
    const start = performance.now();
    let error = false;

    try {
      const encodedKey = encodeKey(key);
      const encodedValue = serializeValue(value);
      const versionstamp = Bun.randomUUIDv7();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = options?.expireIn ? now + Math.floor(options.expireIn / 1000) : null;

      await this.adapter.execute(
        `INSERT OR REPLACE INTO kv_entries (key, value, versionstamp, expires_at)
         VALUES (?, ?, ?, ?)`,
        [encodedKey, encodedValue, versionstamp, expiresAt],
      );

      // Index document if there's a matching FTS index
      const index = await this.fts.getMatchingIndex(key);
      if (index) {
        await this.fts.indexDocument(index.prefix, key, value);
      }

      // Fire triggers after successful write
      await this.fireTriggers("set", key, value, versionstamp);

      return { ok: true, versionstamp };
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("set", performance.now() - start, error);
    }
  }

  /**
   * Delete a key and all keys that start with it (children)
   *
   * @param prefix - Key prefix to delete
   * @param options - Delete options including where filter
   *
   * @example
   * ```typescript
   * // Deletes ["users", 123] AND ["users", 123, "profile"], ["users", 123, "settings"], etc.
   * await kv.delete(["users", 123]);
   *
   * // Delete with filter
   * await kv.delete(["sessions"], {
   *   where: { expiresAt: { $lt: Date.now() } }
   * });
   *
   * // Delete with complex filter
   * await kv.delete(["users"], {
   *   where: {
   *     $or: [
   *       { status: { $eq: "inactive" } },
   *       { "profile.verified": { $eq: false } }
   *     ]
   *   }
   * });
   * ```
   */
  async delete(prefix: KvKey, options?: KvDeleteOptions): Promise<{ deletedCount: number }> {
    const start = performance.now();
    let error = false;

    try {
      const encodedKey = encodeKey(prefix);
      const range = encodePrefixRange(prefix);

      let sql: string;
      let args: unknown[];

      if (options?.where) {
        // Delete with filter: uses json_extract for filtering
        const whereResult = whereToSql(options.where);
        sql = `DELETE FROM kv_entries
               WHERE (key = ? OR (key >= ? AND key < ?))
               AND (expires_at IS NULL OR expires_at > unixepoch())
               AND ${whereResult.sql}`;
        args = [encodedKey, range.start, range.end, ...whereResult.params];
      } else {
        // Delete without filter: delete exact key and all children
        sql = `DELETE FROM kv_entries WHERE key = ? OR (key >= ? AND key < ?)`;
        args = [encodedKey, range.start, range.end];
      }

      const result = await this.adapter.execute<{ changes: number }>(sql, args);
      const deletedCount = (result as unknown as { changes?: number })?.changes ?? 0;

      // Remove from FTS index if there's a matching index
      const index = await this.fts.getMatchingIndex(prefix);
      if (index) {
        await this.fts.removeDocument(index.prefix, prefix);
      }

      // Fire triggers after successful delete
      await this.fireTriggers("delete", prefix);

      return { deletedCount };
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("delete", performance.now() - start, error);
    }
  }

  /**
   * List entries matching a prefix
   *
   * @param prefix - Key prefix to filter by
   * @param options - List options (limit, reverse, start, end, where)
   *
   * @example
   * ```typescript
   * // List all users
   * for await (const entry of kv.list(["users"])) {
   *   console.log(entry);
   * }
   *
   * // List with filter
   * for await (const entry of kv.list(["users"], {
   *   where: { status: { $eq: "active" } }
   * })) {
   *   console.log(entry);
   * }
   * ```
   */
  async *list<T = unknown>(
    prefix: KvKey,
    options: KvListOptions = {},
  ): AsyncIterableIterator<KvEntry<T>> {
    const start = performance.now();
    let error = false;

    try {
      const { start: startKey, end, limit = 100, reverse = false, where } = options;

      let sql = `SELECT key, value, versionstamp FROM kv_entries
                 WHERE (expires_at IS NULL OR expires_at > unixepoch())`;
      const args: unknown[] = [];

      if (prefix.length > 0) {
        const range = encodePrefixRange(prefix);
        sql += " AND key >= ? AND key < ?";
        args.push(range.start, range.end);
      }

      if (startKey) {
        const encodedStart = encodeKey(startKey);
        sql += " AND key >= ?";
        args.push(encodedStart);
      }

      if (end) {
        const encodedEnd = encodeKey(end);
        sql += " AND key < ?";
        args.push(encodedEnd);
      }

      // Apply where filter if provided
      if (where) {
        const whereResult = whereToSql(where);
        sql += ` AND ${whereResult.sql}`;
        args.push(...whereResult.params);
      }

      sql += ` ORDER BY key ${reverse ? "DESC" : "ASC"} LIMIT ?`;
      args.push(limit);

      const rows = await this.adapter.execute<{
        key: Uint8Array | ArrayBuffer;
        value: unknown;
        versionstamp: string;
      }>(sql, args);

      for (const row of rows) {
        const keyBytes =
          row.key instanceof Uint8Array ? row.key : new Uint8Array(row.key as ArrayBuffer);
        yield {
          key: decodeKey(keyBytes),
          value: deserializeValue<T>(row.value),
          versionstamp: row.versionstamp,
        };
      }
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("list", performance.now() - start, error);
    }
  }

  /**
   * Count entries matching a prefix
   *
   * @example
   * ```typescript
   * const count = await kv.count(["users"]);
   * console.log(`Total users: ${count}`);
   * ```
   */
  async count(prefix: KvKey): Promise<number> {
    const start = performance.now();
    let error = false;

    try {
      let sql = `SELECT COUNT(*) as count FROM kv_entries
                 WHERE (expires_at IS NULL OR expires_at > unixepoch())`;
      const args: Uint8Array[] = [];

      if (prefix.length > 0) {
        const range = encodePrefixRange(prefix);
        sql += " AND key >= ? AND key < ?";
        args.push(range.start, range.end);
      }

      const rows = await this.adapter.execute<{ count: number }>(sql, args);
      return rows[0]?.count ?? 0;
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("count", performance.now() - start, error);
    }
  }

  /**
   * Paginate entries with cursor-based pagination
   *
   * @param prefix - Key prefix to filter by
   * @param options - Paginate options (cursor, limit, reverse)
   *
   * @example
   * ```typescript
   * // First page
   * const page1 = await kv.paginate(["users"], { limit: 10 });
   * console.log(page1.entries);
   *
   * // Next page
   * if (page1.hasMore) {
   *   const page2 = await kv.paginate(["users"], {
   *     limit: 10,
   *     cursor: page1.cursor
   *   });
   * }
   * ```
   */
  async paginate<T = unknown>(
    prefix: KvKey,
    options: KvPaginateOptions = {},
  ): Promise<KvPaginateResult<T>> {
    const start = performance.now();
    let error = false;

    try {
      const { cursor, limit = 100, reverse = false } = options;

      let sql = `SELECT key, value, versionstamp FROM kv_entries
                 WHERE (expires_at IS NULL OR expires_at > unixepoch())`;
      const args: (number | Uint8Array)[] = [];

      if (prefix.length > 0) {
        const range = encodePrefixRange(prefix);
        sql += " AND key >= ? AND key < ?";
        args.push(range.start, range.end);
      }

      // Decode cursor (base64 encoded key)
      if (cursor) {
        const cursorKey = Buffer.from(cursor, "base64");
        sql += reverse ? " AND key < ?" : " AND key > ?";
        args.push(new Uint8Array(cursorKey));
      }

      // Fetch limit + 1 to check if there are more entries
      sql += ` ORDER BY key ${reverse ? "DESC" : "ASC"} LIMIT ?`;
      args.push(limit + 1);

      const rows = await this.adapter.execute<{
        key: Uint8Array | ArrayBuffer;
        value: unknown;
        versionstamp: string;
      }>(sql, args);

      const hasMore = rows.length > limit;
      const entries: KvEntry<T>[] = [];

      // Only process up to limit entries
      const processCount = Math.min(rows.length, limit);
      let lastKey: Uint8Array | null = null;

      for (let i = 0; i < processCount; i++) {
        const row = rows[i]!;
        const keyBytes =
          row.key instanceof Uint8Array ? row.key : new Uint8Array(row.key as ArrayBuffer);
        lastKey = keyBytes;
        entries.push({
          key: decodeKey(keyBytes),
          value: deserializeValue<T>(row.value),
          versionstamp: row.versionstamp,
        });
      }

      // Generate cursor from last key
      const nextCursor = hasMore && lastKey ? Buffer.from(lastKey).toString("base64") : null;

      return {
        entries,
        cursor: nextCursor,
        hasMore,
      };
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("paginate", performance.now() - start, error);
    }
  }

  /**
   * Create an atomic operation
   */
  atomic(): AtomicOperation {
    return new AtomicOperation(this.adapter, this.metrics, this);
  }

  /**
   * Create a placeholder for the versionstamp that will be assigned at commit time
   */
  commitVersionstamp(): KvCommitVersionstamp {
    return createCommitVersionstamp();
  }

  /**
   * Execute a transaction with snapshot isolation
   */
  async transaction<T>(
    fn: (tx: KvTransaction) => Promise<T>,
    options?: KvTransactionOptions,
  ): Promise<KvTransactionError | KvTransactionResult<T>> {
    const maxRetries = options?.maxRetries ?? 0;
    const retryDelay = options?.retryDelay ?? 10;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const tx = new KvTransaction(this);

      try {
        const value = await fn(tx);
        const result = await tx.commit();

        if (result.ok) {
          return {
            ok: true,
            value,
            versionstamp: result.versionstamp,
          };
        }

        if (attempt < maxRetries) {
          const delay = retryDelay * 2 ** attempt + Math.random() * retryDelay;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return {
          ok: false,
          error: "conflict",
        };
      } catch (err) {
        return {
          ok: false,
          error: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return {
      ok: false,
      error: "conflict",
    };
  }

  /**
   * Close the KV store and cleanup resources
   */
  async close(): Promise<void> {
    this.stopCleanup();
    this._queue?.close();
    await this._metrics?.close();
    // Note: adapter is managed by plugin-database, don't close it here
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.adapter.execute(
          "DELETE FROM kv_entries WHERE expires_at IS NOT NULL AND expires_at <= unixepoch()",
        );
      } catch (err) {
        this.logger?.error("Cleanup failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        this.metrics.recordOperation("cleanup", 0, true);
      }
    }, 60_000);
  }

  /**
   * Stop periodic cleanup
   */
  private stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
