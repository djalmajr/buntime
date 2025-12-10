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
import { KvMetrics } from "./metrics";
import { KvQueue, type KvQueueCleanupConfig } from "./queue";
import { KvTransaction } from "./transaction";
import {
  createCommitVersionstamp,
  type KvCommitVersionstamp,
  type KvEntry,
  type KvGetOptions,
  type KvKey,
  type KvListOptions,
  type KvSetOptions,
  type KvTransactionError,
  type KvTransactionOptions,
  type KvTransactionResult,
  type KvTriggerConfig,
  type KvTriggerEvent,
  type KvTriggerEventType,
} from "./types";

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
   * Get a value by key
   */
  async get<T = unknown>(key: KvKey, _options?: KvGetOptions): Promise<KvEntry<T>> {
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
   * Get multiple values by keys
   */
  async getMany<T = unknown>(keys: KvKey[], _options?: KvGetOptions): Promise<KvEntry<T>[]> {
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
      this.metrics.recordOperation("getMany", performance.now() - start, error);
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
   * Delete a key
   */
  async delete(key: KvKey): Promise<void> {
    const start = performance.now();
    let error = false;

    try {
      const encodedKey = encodeKey(key);

      await this.adapter.execute("DELETE FROM kv_entries WHERE key = ?", [encodedKey]);

      // Fire triggers after successful delete
      await this.fireTriggers("delete", key);
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("delete", performance.now() - start, error);
    }
  }

  /**
   * List entries matching a selector
   */
  async *list<T = unknown>(options: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const start = performance.now();
    let error = false;

    try {
      const { prefix, start: startKey, end, limit = 100, reverse = false } = options;

      let sql = `SELECT key, value, versionstamp FROM kv_entries
                 WHERE (expires_at IS NULL OR expires_at > unixepoch())`;
      const args: (number | Uint8Array)[] = [];

      if (prefix && prefix.length > 0) {
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
