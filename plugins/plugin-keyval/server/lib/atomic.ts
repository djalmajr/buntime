import { ValidationError } from "@buntime/shared/errors";
import { deserializeValue, encodeKey, serializeValue } from "./encoding";
import type { Kv } from "./kv";
import type { KvMetrics } from "./metrics";
import type { KeyValSqlAdapter, KeyValTransactionAdapter } from "./sql-adapter.ts";
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

interface ResolvedTriggerMutation {
  key: KvKey;
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

function getArrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getNumericValue(value: unknown, operation: string): number {
  if (typeof value === "bigint") {
    return bigIntToNumber(value, operation);
  }

  if (typeof value === "number") {
    return value;
  }

  throw new ValidationError(`Invalid ${operation} mutation value.`, "INVALID_ATOMIC_VALUE");
}

async function getStoredValue(
  tx: KeyValTransactionAdapter,
  encodedKey: Uint8Array,
): Promise<unknown | null> {
  const row = await tx.executeOne<{ value: unknown }>(
    "SELECT value FROM kv_entries WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())",
    [encodedKey],
  );

  return row ? deserializeValue(row.value) : null;
}

/**
 * Atomic operation builder for KV transactions
 * Implements optimistic concurrency control using versionstamps
 */
export class AtomicOperation {
  private checks: KvCheck[] = [];
  private mutations: KvMutationInternal[] = [];

  constructor(
    private adapter: KeyValSqlAdapter,
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

      // Generate new versionstamp for this commit
      const versionstamp = Bun.randomUUIDv7();
      const now = Math.floor(Date.now() / 1000);
      const triggerMutations: ResolvedTriggerMutation[] = [];

      const committed = await this.adapter.transaction(async (tx) => {
        // First, verify all checks inside the same write transaction as mutations.
        for (const check of this.checks) {
          const encodedKey = encodeKey(check.key);
          const row = await tx.executeOne<{ versionstamp: string }>(
            "SELECT versionstamp FROM kv_entries WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())",
            [encodedKey],
          );

          const currentVersionstamp = row?.versionstamp;

          if (check.versionstamp === null) {
            if (currentVersionstamp !== undefined) {
              return false;
            }
          } else if (currentVersionstamp !== check.versionstamp) {
            return false;
          }
        }

        for (const mutation of this.mutations) {
          const resolvedKey = resolveKey(mutation.key, versionstamp);
          const encodedKey = encodeKey(resolvedKey);
          const expiresAt = mutation.expiresIn ? now + Math.floor(mutation.expiresIn / 1000) : null;

          switch (mutation.type) {
            case "delete":
              await tx.execute("DELETE FROM kv_entries WHERE key = ?", [encodedKey]);
              triggerMutations.push({ key: resolvedKey, type: mutation.type });
              break;

            case "set": {
              const encodedValue = serializeValue(mutation.value);
              await tx.execute(
                `INSERT OR REPLACE INTO kv_entries (key, value, versionstamp, expires_at)
                 VALUES (?, ?, ?, ?)`,
                [encodedKey, encodedValue, versionstamp, expiresAt],
              );
              triggerMutations.push({
                key: resolvedKey,
                type: mutation.type,
                value: mutation.value,
              });
              break;
            }

            case "sum": {
              const operand = getNumericValue(mutation.value, "sum");
              const currentValue = await getStoredValue(tx, encodedKey);
              const currentNumber = typeof currentValue === "number" ? currentValue : 0;
              const nextValue = currentNumber + operand;

              await this.setStoredValue(tx, encodedKey, nextValue, versionstamp, expiresAt);
              triggerMutations.push({ key: resolvedKey, type: mutation.type, value: nextValue });
              break;
            }

            case "max": {
              const operand = getNumericValue(mutation.value, "max");
              const currentValue = await getStoredValue(tx, encodedKey);
              const currentNumber = typeof currentValue === "number" ? currentValue : operand;
              const nextValue = Math.max(currentNumber, operand);

              await this.setStoredValue(tx, encodedKey, nextValue, versionstamp, expiresAt);
              triggerMutations.push({ key: resolvedKey, type: mutation.type, value: nextValue });
              break;
            }

            case "min": {
              const operand = getNumericValue(mutation.value, "min");
              const currentValue = await getStoredValue(tx, encodedKey);
              const currentNumber = typeof currentValue === "number" ? currentValue : operand;
              const nextValue = Math.min(currentNumber, operand);

              await this.setStoredValue(tx, encodedKey, nextValue, versionstamp, expiresAt);
              triggerMutations.push({ key: resolvedKey, type: mutation.type, value: nextValue });
              break;
            }

            case "append": {
              const currentValue = await getStoredValue(tx, encodedKey);
              const nextValue = [...getArrayValue(currentValue), ...getArrayValue(mutation.value)];

              await this.setStoredValue(tx, encodedKey, nextValue, versionstamp, expiresAt);
              triggerMutations.push({ key: resolvedKey, type: mutation.type, value: nextValue });
              break;
            }

            case "prepend": {
              const currentValue = await getStoredValue(tx, encodedKey);
              const nextValue = [...getArrayValue(mutation.value), ...getArrayValue(currentValue)];

              await this.setStoredValue(tx, encodedKey, nextValue, versionstamp, expiresAt);
              triggerMutations.push({ key: resolvedKey, type: mutation.type, value: nextValue });
              break;
            }

            default: {
              const _exhaustive: never = mutation.type;
              throw new ValidationError(
                `Unknown mutation type: ${_exhaustive}`,
                "UNKNOWN_ATOMIC_MUTATION",
              );
            }
          }
        }

        return true;
      });

      if (!committed) {
        return { ok: false };
      }

      // Fire triggers for each mutation
      if (this.kv) {
        for (const mutation of triggerMutations) {
          if (mutation.type === "set") {
            await this.kv.fireTriggers("set", mutation.key, mutation.value, versionstamp);
          } else if (mutation.type === "delete") {
            await this.kv.fireTriggers("delete", mutation.key, undefined, versionstamp);
          }
          // Note: sum, max, min, append, prepend are treated as "set" for trigger purposes
          else if (["sum", "max", "min", "append", "prepend"].includes(mutation.type)) {
            await this.kv.fireTriggers("set", mutation.key, mutation.value, versionstamp);
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

  private async setStoredValue(
    tx: KeyValTransactionAdapter,
    encodedKey: Uint8Array,
    value: unknown,
    versionstamp: string,
    expiresAt: number | null,
  ): Promise<void> {
    await tx.execute(
      `INSERT OR REPLACE INTO kv_entries (key, value, versionstamp, expires_at)
       VALUES (?, ?, ?, ?)`,
      [encodedKey, serializeValue(value), versionstamp, expiresAt],
    );
  }
}
