import { encodeKey } from "./encoding";
import type { Kv } from "./kv";
import type { KvEntry, KvKey, KvMutation, KvSetOptions } from "./types";

/**
 * Transaction execution context
 * Provides snapshot isolation for reads and buffers writes until commit
 *
 * @example
 * ```typescript
 * const result = await kv.transaction(async (tx) => {
 *   const balance = await tx.get<number>(["balance", userId]);
 *   const price = await tx.get<number>(["products", productId, "price"]);
 *
 *   if ((balance.value ?? 0) < (price.value ?? 0)) {
 *     throw new Error("Insufficient balance");
 *   }
 *
 *   tx.set(["balance", userId], (balance.value ?? 0) - (price.value ?? 0));
 *   tx.set(["orders", orderId], { productId, amount: price.value });
 *
 *   return { success: true };
 * });
 * ```
 */
export class KvTransaction {
  private reads = new Map<string, KvEntry>();
  private writes: KvMutation[] = [];
  private committed = false;

  constructor(private kv: Kv) {}

  /**
   * Get a value by key with snapshot isolation
   * Subsequent reads of the same key return the cached value
   */
  async get<T = unknown>(key: KvKey): Promise<KvEntry<T>> {
    if (this.committed) {
      throw new Error("Transaction already committed");
    }

    const keyHex = Buffer.from(encodeKey(key)).toString("hex");

    // Return cached read if available
    const cached = this.reads.get(keyHex);
    if (cached) {
      return cached as KvEntry<T>;
    }

    // Read from database and cache
    const entry = await this.kv.get<T>(key);
    this.reads.set(keyHex, entry as KvEntry);
    return entry;
  }

  /**
   * Get multiple values by keys with snapshot isolation
   */
  async getMany<T = unknown>(keys: KvKey[]): Promise<KvEntry<T>[]> {
    if (this.committed) {
      throw new Error("Transaction already committed");
    }

    const results: KvEntry<T>[] = [];
    const uncachedKeys: KvKey[] = [];
    const uncachedIndices: number[] = [];

    // Check cache first
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!key) continue;

      const keyHex = Buffer.from(encodeKey(key)).toString("hex");
      const cached = this.reads.get(keyHex);

      if (cached) {
        results[i] = cached as KvEntry<T>;
      } else {
        uncachedKeys.push(key);
        uncachedIndices.push(i);
      }
    }

    // Fetch uncached keys
    if (uncachedKeys.length > 0) {
      const entries = await this.kv.getMany<T>(uncachedKeys);

      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        const index = uncachedIndices[j];
        if (entry && index !== undefined) {
          const keyHex = Buffer.from(encodeKey(entry.key)).toString("hex");
          this.reads.set(keyHex, entry as KvEntry);
          results[index] = entry;
        }
      }
    }

    return results;
  }

  /**
   * Set a key-value pair (buffered until commit)
   */
  set(key: KvKey, value: unknown, options?: KvSetOptions): this {
    if (this.committed) {
      throw new Error("Transaction already committed");
    }

    this.writes.push({
      key,
      type: "set",
      value,
      expireIn: options?.expireIn,
    });
    return this;
  }

  /**
   * Delete a key (buffered until commit)
   */
  delete(key: KvKey): this {
    if (this.committed) {
      throw new Error("Transaction already committed");
    }

    this.writes.push({
      key,
      type: "delete",
    });
    return this;
  }

  /**
   * Sum a value atomically (buffered until commit)
   */
  sum(key: KvKey, value: bigint): this {
    if (this.committed) {
      throw new Error("Transaction already committed");
    }

    this.writes.push({
      key,
      type: "sum",
      value,
    });
    return this;
  }

  /**
   * Commit the transaction
   * Validates all read versionstamps and applies writes atomically
   *
   * @internal This is called automatically by kv.transaction()
   */
  async commit(): Promise<{ ok: true; versionstamp: string } | { ok: false }> {
    if (this.committed) {
      throw new Error("Transaction already committed");
    }

    this.committed = true;

    // Build atomic operation with checks for all reads
    const atomic = this.kv.atomic();

    // Add version checks for all reads
    for (const entry of this.reads.values()) {
      atomic.check({
        key: entry.key,
        versionstamp: entry.versionstamp,
      });
    }

    // Add all writes
    for (const mutation of this.writes) {
      switch (mutation.type) {
        case "set":
          atomic.set(mutation.key, mutation.value, { expireIn: mutation.expireIn });
          break;
        case "delete":
          atomic.delete(mutation.key);
          break;
        case "sum":
          atomic.sum(mutation.key, mutation.value as bigint);
          break;
        case "max":
          atomic.max(mutation.key, mutation.value as bigint);
          break;
        case "min":
          atomic.min(mutation.key, mutation.value as bigint);
          break;
        case "append":
          atomic.append(mutation.key, mutation.value as unknown[]);
          break;
        case "prepend":
          atomic.prepend(mutation.key, mutation.value as unknown[]);
          break;
      }
    }

    return atomic.commit();
  }

  /**
   * Get the number of reads cached in this transaction
   */
  get readCount(): number {
    return this.reads.size;
  }

  /**
   * Get the number of writes buffered in this transaction
   */
  get writeCount(): number {
    return this.writes.length;
  }
}
