import type { DatabaseAdapter } from "@buntime/plugin-database";
import { encodeKey, serializeValue } from "./encoding";
import type { Kv } from "./kv";
import type { KvMetrics } from "./metrics";
import {
  type KvCheck,
  type KvCommitError,
  type KvCommitResult,
  type KvKey,
  type KvKeyPart,
  type KvKeyWithUuidv7,
  type KvMutationType,
  type KvSetOptions,
  type KvUuidv7,
  UUIDV7_SYMBOL,
} from "./types";

/**
 * Internal mutation type that supports keys with uuidv7 placeholders
 */
interface KvMutationInternal {
  expiresIn?: number;
  key: KvKeyWithUuidv7;
  type: KvMutationType;
  value?: unknown;
}

/**
 * Check if a value is a uuidv7 placeholder
 */
function isUuidv7Placeholder(value: unknown): value is KvUuidv7 {
  return typeof value === "object" && value !== null && UUIDV7_SYMBOL in value;
}

/**
 * Resolve uuidv7 placeholders in a key
 */
function resolveKey(key: KvKeyWithUuidv7, uuidv7: string): KvKey {
  return key.map((part) => {
    if (isUuidv7Placeholder(part)) {
      return uuidv7;
    }
    return part as KvKeyPart;
  });
}

/**
 * Safely convert BigInt to Number, throwing if precision would be lost
 */
function bigIntToNumber(value: bigint, operation: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(
      `BigInt value ${value} exceeds safe integer range for ${operation} operation. ` +
        `Use values between ${Number.MIN_SAFE_INTEGER} and ${Number.MAX_SAFE_INTEGER}.`,
    );
  }
  return Number(value);
}

/**
 * Atomic operation builder for KV transactions
 * Implements optimistic concurrency control using versionstamps
 */
export class AtomicOperation {
  private checks: KvCheck[] = [];
  private mutations: KvMutationInternal[] = [];

  constructor(
    private adapter: DatabaseAdapter,
    private metrics: KvMetrics,
    private kv?: Kv,
  ) {}

  /**
   * Add a version check for a key
   */
  check(...checks: KvCheck[]): this {
    this.checks.push(...checks);
    return this;
  }

  /**
   * Set a key-value pair
   */
  set(key: KvKeyWithUuidv7, value: unknown, options?: KvSetOptions): this {
    this.mutations.push({
      key,
      type: "set",
      value,
      expiresIn: options?.expiresIn,
    });
    return this;
  }

  /**
   * Delete a key
   */
  delete(key: KvKeyWithUuidv7): this {
    this.mutations.push({
      key,
      type: "delete",
    });
    return this;
  }

  /**
   * Add a value to an existing numeric value atomically
   */
  sum(key: KvKeyWithUuidv7, value: bigint): this {
    this.mutations.push({
      key,
      type: "sum",
      value,
    });
    return this;
  }

  /**
   * Set to the maximum of the current value and the provided value
   */
  max(key: KvKeyWithUuidv7, value: bigint): this {
    this.mutations.push({
      key,
      type: "max",
      value,
    });
    return this;
  }

  /**
   * Set to the minimum of the current value and the provided value
   */
  min(key: KvKeyWithUuidv7, value: bigint): this {
    this.mutations.push({
      key,
      type: "min",
      value,
    });
    return this;
  }

  /**
   * Append values to an existing array atomically
   */
  append(key: KvKeyWithUuidv7, values: unknown[]): this {
    this.mutations.push({
      key,
      type: "append",
      value: values,
    });
    return this;
  }

  /**
   * Prepend values to an existing array atomically
   */
  prepend(key: KvKeyWithUuidv7, values: unknown[]): this {
    this.mutations.push({
      key,
      type: "prepend",
      value: values,
    });
    return this;
  }

  /**
   * Commit the atomic operation
   */
  async commit(): Promise<KvCommitError | KvCommitResult> {
    const start = performance.now();
    let error = false;

    try {
      if (this.checks.length === 0 && this.mutations.length === 0) {
        return { ok: true, versionstamp: Bun.randomUUIDv7() };
      }

      // First, verify all checks
      if (this.checks.length > 0) {
        for (const check of this.checks) {
          const encodedKey = encodeKey(check.key);
          const row = await this.adapter.executeOne<{ versionstamp: string }>(
            "SELECT versionstamp FROM kv_entries WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())",
            [encodedKey],
          );

          const currentVersionstamp = row?.versionstamp;

          if (check.versionstamp === null) {
            if (currentVersionstamp !== undefined) {
              return { ok: false };
            }
          } else {
            if (currentVersionstamp !== check.versionstamp) {
              return { ok: false };
            }
          }
        }
      }

      // Generate new versionstamp for this commit
      const versionstamp = Bun.randomUUIDv7();
      const now = Math.floor(Date.now() / 1000);

      // Build mutation statements
      const statements = this.mutations.map((mutation) => {
        const resolvedKey = resolveKey(mutation.key, versionstamp);
        const encodedKey = encodeKey(resolvedKey);
        const expiresAt = mutation.expiresIn ? now + Math.floor(mutation.expiresIn / 1000) : null;

        switch (mutation.type) {
          case "delete":
            return {
              sql: "DELETE FROM kv_entries WHERE key = ?",
              args: [encodedKey],
            };

          case "set": {
            const encodedValue = serializeValue(mutation.value);
            return {
              sql: `INSERT OR REPLACE INTO kv_entries (key, value, versionstamp, expires_at)
                    VALUES (?, ?, ?, ?)`,
              args: [encodedKey, encodedValue, versionstamp, expiresAt],
            };
          }

          case "sum": {
            const numValue =
              typeof mutation.value === "bigint"
                ? bigIntToNumber(mutation.value, "sum")
                : mutation.value;
            const encodedValue = serializeValue(numValue);
            return {
              sql: `INSERT INTO kv_entries (key, value, versionstamp, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                      value = (
                        SELECT CAST(json(COALESCE(json_extract(CAST(kv_entries.value AS TEXT), '$'), 0) + json_extract(CAST(excluded.value AS TEXT), '$')) AS BLOB)
                      ),
                      versionstamp = excluded.versionstamp,
                      expires_at = excluded.expires_at`,
              args: [encodedKey, encodedValue, versionstamp, expiresAt],
            };
          }

          case "max": {
            const numValue =
              typeof mutation.value === "bigint"
                ? bigIntToNumber(mutation.value, "max")
                : mutation.value;
            const encodedValue = serializeValue(numValue);
            return {
              sql: `INSERT INTO kv_entries (key, value, versionstamp, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                      value = (
                        SELECT CAST(json(MAX(COALESCE(json_extract(CAST(kv_entries.value AS TEXT), '$'), json_extract(CAST(excluded.value AS TEXT), '$')), json_extract(CAST(excluded.value AS TEXT), '$'))) AS BLOB)
                      ),
                      versionstamp = excluded.versionstamp,
                      expires_at = excluded.expires_at`,
              args: [encodedKey, encodedValue, versionstamp, expiresAt],
            };
          }

          case "min": {
            const numValue =
              typeof mutation.value === "bigint"
                ? bigIntToNumber(mutation.value, "min")
                : mutation.value;
            const encodedValue = serializeValue(numValue);
            return {
              sql: `INSERT INTO kv_entries (key, value, versionstamp, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                      value = (
                        SELECT CAST(json(MIN(COALESCE(json_extract(CAST(kv_entries.value AS TEXT), '$'), json_extract(CAST(excluded.value AS TEXT), '$')), json_extract(CAST(excluded.value AS TEXT), '$'))) AS BLOB)
                      ),
                      versionstamp = excluded.versionstamp,
                      expires_at = excluded.expires_at`,
              args: [encodedKey, encodedValue, versionstamp, expiresAt],
            };
          }

          case "append": {
            const encodedValue = serializeValue(mutation.value);
            return {
              sql: `INSERT INTO kv_entries (key, value, versionstamp, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                      value = (
                        SELECT CAST(json_group_array(value) AS BLOB) FROM (
                          SELECT value FROM json_each(COALESCE(CAST(kv_entries.value AS TEXT), '[]'))
                          UNION ALL
                          SELECT value FROM json_each(CAST(excluded.value AS TEXT))
                        )
                      ),
                      versionstamp = excluded.versionstamp,
                      expires_at = excluded.expires_at`,
              args: [encodedKey, encodedValue, versionstamp, expiresAt],
            };
          }

          case "prepend": {
            const encodedValue = serializeValue(mutation.value);
            return {
              sql: `INSERT INTO kv_entries (key, value, versionstamp, expires_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                      value = (
                        SELECT CAST(json_group_array(value) AS BLOB) FROM (
                          SELECT value FROM json_each(CAST(excluded.value AS TEXT))
                          UNION ALL
                          SELECT value FROM json_each(COALESCE(CAST(kv_entries.value AS TEXT), '[]'))
                        )
                      ),
                      versionstamp = excluded.versionstamp,
                      expires_at = excluded.expires_at`,
              args: [encodedKey, encodedValue, versionstamp, expiresAt],
            };
          }

          default: {
            const _exhaustive: never = mutation.type;
            throw new Error(`Unknown mutation type: ${_exhaustive}`);
          }
        }
      });

      // Execute all mutations in a batch
      if (statements.length > 0) {
        await this.adapter.batch(statements);
      }

      // Fire triggers for each mutation
      if (this.kv) {
        for (const mutation of this.mutations) {
          const resolvedKey = resolveKey(mutation.key, versionstamp);
          if (mutation.type === "set") {
            await this.kv.fireTriggers("set", resolvedKey, mutation.value, versionstamp);
          } else if (mutation.type === "delete") {
            await this.kv.fireTriggers("delete", resolvedKey, undefined, versionstamp);
          }
          // Note: sum, max, min, append, prepend are treated as "set" for trigger purposes
          else if (["sum", "max", "min", "append", "prepend"].includes(mutation.type)) {
            await this.kv.fireTriggers("set", resolvedKey, mutation.value, versionstamp);
          }
        }
      }

      return { ok: true, versionstamp };
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.metrics.recordOperation("atomic_commit", performance.now() - start, error);
    }
  }
}
