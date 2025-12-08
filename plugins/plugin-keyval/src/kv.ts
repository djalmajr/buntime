import type { Client } from "@libsql/client";
import { AtomicOperation } from "./atomic";
import {
  decodeKey,
  deserializeValue,
  encodeKey,
  encodePrefixRange,
  serializeValue,
} from "./encoding";
import { generateVersionstamp } from "./schema";
import type { KvEntry, KvKey, KvListOptions, KvSetOptions } from "./types";

/**
 * Key-Value store implementation backed by libSQL
 * API inspired by Deno KV
 */
export class Kv {
  private cleanupInterval: Timer | null = null;

  constructor(private client: Client) {
    this.startCleanup();
  }

  /**
   * Get a value by key
   */
  async get<T = unknown>(key: KvKey): Promise<KvEntry<T>> {
    const encodedKey = encodeKey(key);

    const result = await this.client.execute({
      sql: `SELECT key, value, versionstamp FROM kv_entries
            WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())`,
      args: [encodedKey],
    });

    const row = result.rows[0];
    if (!row) {
      return { key, value: null, versionstamp: null };
    }

    return {
      key,
      value: deserializeValue<T>(row.value),
      versionstamp: row.versionstamp as string,
    };
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T = unknown>(keys: KvKey[]): Promise<KvEntry<T>[]> {
    if (keys.length === 0) return [];

    const encodedKeys = keys.map(encodeKey);
    const placeholders = encodedKeys.map(() => "?").join(", ");

    const result = await this.client.execute({
      sql: `SELECT key, value, versionstamp FROM kv_entries
            WHERE key IN (${placeholders}) AND (expires_at IS NULL OR expires_at > unixepoch())`,
      args: encodedKeys,
    });

    // Create a map of results
    const resultMap = new Map<string, { value: unknown; versionstamp: string }>();
    for (const row of result.rows) {
      const keyBytes = row.key instanceof Uint8Array ? row.key : new Uint8Array(row.key as ArrayBuffer);
      const keyHex = Buffer.from(keyBytes).toString("hex");
      resultMap.set(keyHex, {
        value: row.value,
        versionstamp: row.versionstamp as string,
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
  }

  /**
   * Set a key-value pair
   */
  async set<T>(key: KvKey, value: T, options?: KvSetOptions): Promise<{ ok: true; versionstamp: string }> {
    const encodedKey = encodeKey(key);
    const encodedValue = serializeValue(value);
    const versionstamp = generateVersionstamp();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = options?.expireIn ? now + Math.floor(options.expireIn / 1000) : null;

    await this.client.execute({
      sql: `INSERT OR REPLACE INTO kv_entries (key, value, versionstamp, expires_at)
            VALUES (?, ?, ?, ?)`,
      args: [encodedKey, encodedValue, versionstamp, expiresAt],
    });

    return { ok: true, versionstamp };
  }

  /**
   * Delete a key
   */
  async delete(key: KvKey): Promise<void> {
    const encodedKey = encodeKey(key);

    await this.client.execute({
      sql: "DELETE FROM kv_entries WHERE key = ?",
      args: [encodedKey],
    });
  }

  /**
   * List entries matching a selector
   */
  async *list<T = unknown>(options: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const { prefix, start, end, limit = 100, reverse = false } = options;

    let sql = `SELECT key, value, versionstamp FROM kv_entries
               WHERE (expires_at IS NULL OR expires_at > unixepoch())`;
    const args: (number | Uint8Array)[] = [];

    if (prefix && prefix.length > 0) {
      const range = encodePrefixRange(prefix);
      sql += " AND key >= ? AND key < ?";
      args.push(range.start, range.end);
    }

    if (start) {
      const encodedStart = encodeKey(start);
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

    const result = await this.client.execute({ sql, args });

    for (const row of result.rows) {
      const keyBytes = row.key instanceof Uint8Array ? row.key : new Uint8Array(row.key as ArrayBuffer);
      yield {
        key: decodeKey(keyBytes),
        value: deserializeValue<T>(row.value),
        versionstamp: row.versionstamp as string,
      };
    }
  }

  /**
   * Create an atomic operation
   */
  atomic(): AtomicOperation {
    return new AtomicOperation(this.client);
  }

  /**
   * Close the KV store and cleanup resources
   */
  close(): void {
    this.stopCleanup();
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    // Run cleanup every 60 seconds
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.client.execute({
          sql: "DELETE FROM kv_entries WHERE expires_at IS NOT NULL AND expires_at <= unixepoch()",
          args: [],
        });
      } catch {
        // Ignore cleanup errors
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
