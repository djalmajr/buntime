import {
  type KvCheck,
  type KvCommitError,
  type KvCommitResult,
  type KvCreateIndexOptions,
  type KvDeleteOptions,
  type KvDeleteResult,
  type KvDlqListOptions,
  type KvDlqMessage,
  type KvEnqueueOptions,
  type KvEntry,
  type KvIndex,
  type KvKey,
  type KvListenHandle,
  type KvListenOptions,
  type KvListOptions,
  type KvMetrics,
  type KvNow,
  type KvPaginateOptions,
  type KvPaginateResult,
  type KvQueueMessage,
  type KvQueueStats,
  type KvSearchOptions,
  type KvSetOptions,
  type KvTransactionError,
  type KvTransactionOptions,
  type KvTransactionResult,
  type KvWatchCallback,
  type KvWatchHandle,
  type KvWatchOptions,
  type KvWatchOverflowStrategy,
  NOW_SYMBOL,
} from "./types";

/**
 * Check if a value is a $now placeholder
 */
function isNowPlaceholder(value: unknown): value is KvNow {
  return (
    typeof value === "object" &&
    value !== null &&
    NOW_SYMBOL in value &&
    (value as KvNow)[NOW_SYMBOL] === true
  );
}

/**
 * JSON replacer to handle BigInt and $now serialization
 * - Converts BigInt to a tagged object { __type: "bigint", value: string }
 * - Converts $now placeholder to { $now: true } for server-side resolution
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return { __type: "bigint", value: value.toString() };
  }
  if (isNowPlaceholder(value)) {
    return { $now: true };
  }
  return value;
}

/**
 * Watch buffer for managing backpressure
 * Coalesces changes for the same key and applies overflow strategy
 */
class WatchBuffer<T> {
  private buffer: Map<string, KvEntry<T>> = new Map();
  private order: string[] = [];

  constructor(
    private maxSize: number | null,
    private strategy: KvWatchOverflowStrategy,
  ) {}

  /**
   * Add entries to the buffer, coalescing by key
   * Returns true if any entries were added
   */
  add(entries: KvEntry<T>[]): boolean {
    let added = false;

    for (const entry of entries) {
      const keyStr = JSON.stringify(entry.key);
      const exists = this.buffer.has(keyStr);

      // If buffer is full and this is a new key
      if (!exists && this.maxSize !== null && this.buffer.size >= this.maxSize) {
        if (this.strategy === "drop-newest") {
          // Ignore new entry
          continue;
        }
        // drop-oldest: remove oldest entry
        const oldestKey = this.order.shift();
        if (oldestKey) {
          this.buffer.delete(oldestKey);
        }
      }

      // Update or add entry
      this.buffer.set(keyStr, entry);
      added = true;

      // Update order tracking
      if (!exists) {
        this.order.push(keyStr);
      }
    }

    return added;
  }

  /**
   * Flush all entries from the buffer
   * Returns entries in insertion order
   */
  flush(): KvEntry<T>[] {
    const entries: KvEntry<T>[] = [];
    for (const keyStr of this.order) {
      const entry = this.buffer.get(keyStr);
      if (entry) {
        entries.push(entry);
      }
    }
    this.buffer.clear();
    this.order = [];
    return entries;
  }

  /**
   * Check if buffer has entries
   */
  hasEntries(): boolean {
    return this.buffer.size > 0;
  }
}

/**
 * Mutation type for atomic operations
 */
type MutationType = "append" | "delete" | "max" | "min" | "prepend" | "set" | "sum";

/**
 * Internal mutation structure
 */
interface Mutation {
  expireIn?: number;
  key: KvKey;
  type: MutationType;
  value?: unknown;
}

/**
 * Atomic operation builder for KV transactions
 */
export class KvAtomicOperation {
  private checks: KvCheck[] = [];
  private mutations: Mutation[] = [];

  constructor(private kv: Kv) {}

  /**
   * Add a version check for a key
   */
  check(...checks: KvCheck[]): this {
    this.checks.push(...checks);
    return this;
  }

  /**
   * Set a key-value pair
   *
   * @example
   * ```typescript
   * await kv.atomic()
   *   .set(["posts", postId], post)
   *   .commit();
   * ```
   */
  set(key: KvKey, value: unknown, options?: KvSetOptions): this {
    this.mutations.push({
      type: "set",
      key,
      value,
      expireIn: options?.expireIn,
    });
    return this;
  }

  /**
   * Delete a key
   */
  delete(key: KvKey): this {
    this.mutations.push({ type: "delete", key });
    return this;
  }

  /**
   * Add a value to an existing numeric value atomically
   * If the key doesn't exist, it's initialized to the value
   *
   * @example
   * ```typescript
   * await kv.atomic()
   *   .sum(["views", postId], 1n)        // Increment by 1
   *   .sum(["balance", userId], -100n)   // Decrement by 100
   *   .commit();
   * ```
   */
  sum(key: KvKey, value: bigint): this {
    this.mutations.push({ type: "sum", key, value });
    return this;
  }

  /**
   * Set to the maximum of the current value and the provided value
   * If the key doesn't exist, sets the value
   *
   * @example
   * ```typescript
   * await kv.atomic()
   *   .max(["highscore", userId], score)
   *   .commit();
   * ```
   */
  max(key: KvKey, value: bigint): this {
    this.mutations.push({ type: "max", key, value });
    return this;
  }

  /**
   * Set to the minimum of the current value and the provided value
   * If the key doesn't exist, sets the value
   *
   * @example
   * ```typescript
   * await kv.atomic()
   *   .min(["lowest_price", productId], price)
   *   .commit();
   * ```
   */
  min(key: KvKey, value: bigint): this {
    this.mutations.push({ type: "min", key, value });
    return this;
  }

  /**
   * Append values to an existing array atomically
   * If the key doesn't exist, creates a new array with the values
   *
   * @example
   * ```typescript
   * await kv.atomic()
   *   .append(["logs", userId], ["Order placed", "Payment received"])
   *   .commit();
   * ```
   */
  append(key: KvKey, values: unknown[]): this {
    this.mutations.push({ type: "append", key, value: values });
    return this;
  }

  /**
   * Prepend values to an existing array atomically
   * If the key doesn't exist, creates a new array with the values
   *
   * @example
   * ```typescript
   * await kv.atomic()
   *   .prepend(["recent_activity", userId], [newActivity])
   *   .commit();
   * ```
   */
  prepend(key: KvKey, values: unknown[]): this {
    this.mutations.push({ type: "prepend", key, value: values });
    return this;
  }

  /**
   * Commit the atomic operation
   */
  async commit(): Promise<KvCommitError | KvCommitResult> {
    return this.kv._commitAtomic(this.checks, this.mutations);
  }
}

/**
 * Transaction for KV operations with snapshot isolation
 *
 * Provides read caching (snapshot isolation) and write buffering.
 * All reads are cached for the duration of the transaction.
 * All writes are buffered and committed atomically with version checks.
 *
 * @example
 * ```typescript
 * const result = await kv.transaction(async (tx) => {
 *   const user = await tx.get(["users", userId]);
 *   if (!user.value) throw new Error("User not found");
 *
 *   const balance = user.value.balance - amount;
 *   tx.set(["users", userId], { ...user.value, balance });
 *
 *   return { newBalance: balance };
 * });
 *
 * if (result.ok) {
 *   console.log("New balance:", result.value.newBalance);
 * }
 * ```
 */
export class KvTransaction {
  private readCache = new Map<string, KvEntry<unknown>>();
  private mutations: Mutation[] = [];

  constructor(private kv: Kv) {}

  /**
   * Check if keys is a nested array (KvKey[]) vs single key (KvKey)
   */
  private isNestedKeyArray(keys: KvKey | KvKey[]): boolean {
    return Array.isArray(keys) && keys.length > 0 && Array.isArray(keys[0]);
  }

  /**
   * Get value(s) by key(s) (cached for snapshot isolation)
   */
  async get<T = unknown>(keys: []): Promise<KvEntry<T>[]>;
  async get<T = unknown>(keys: KvKey): Promise<KvEntry<T>>;
  async get<T = unknown>(keys: KvKey[]): Promise<KvEntry<T>[]>;
  async get<T = unknown>(keys: KvKey | KvKey[]): Promise<KvEntry<T> | KvEntry<T>[]> {
    // Empty array - return empty result
    if (Array.isArray(keys) && keys.length === 0) {
      return [];
    }

    // Multiple keys - batch with cache
    if (this.isNestedKeyArray(keys)) {
      return this.getBatch<T>(keys as KvKey[]);
    }

    // Single key
    return this.getSingle<T>(keys as KvKey);
  }

  /**
   * Get a single value by key (cached for snapshot isolation)
   */
  private async getSingle<T = unknown>(key: KvKey): Promise<KvEntry<T>> {
    const keyStr = JSON.stringify(key);

    if (this.readCache.has(keyStr)) {
      return this.readCache.get(keyStr) as KvEntry<T>;
    }

    const entry = await this.kv.get<T>(key);
    this.readCache.set(keyStr, entry as KvEntry<unknown>);
    return entry;
  }

  /**
   * Get multiple values by keys (cached for snapshot isolation)
   */
  private async getBatch<T = unknown>(keys: KvKey[]): Promise<KvEntry<T>[]> {
    const results: KvEntry<T>[] = new Array(keys.length);
    const uncachedKeys: KvKey[] = [];
    const uncachedIndices: number[] = [];

    // Check cache first
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const keyStr = JSON.stringify(key);
      if (this.readCache.has(keyStr)) {
        results[i] = this.readCache.get(keyStr) as KvEntry<T>;
      } else {
        uncachedKeys.push(key);
        uncachedIndices.push(i);
      }
    }

    // Fetch uncached keys
    if (uncachedKeys.length > 0) {
      const entries = await this.kv.get<T>(uncachedKeys);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const originalIndex = uncachedIndices[i]!;
        results[originalIndex] = entry;
        this.readCache.set(JSON.stringify(entry.key), entry as KvEntry<unknown>);
      }
    }

    return results;
  }

  /**
   * Set a key-value pair (buffered until commit)
   */
  set(key: KvKey, value: unknown, options?: KvSetOptions): this {
    this.mutations.push({
      type: "set",
      key,
      value,
      expireIn: options?.expireIn,
    });
    return this;
  }

  /**
   * Delete a key (buffered until commit)
   */
  delete(key: KvKey): this {
    this.mutations.push({ type: "delete", key });
    return this;
  }

  /**
   * Add a value to an existing numeric value atomically (buffered until commit)
   */
  sum(key: KvKey, value: bigint): this {
    this.mutations.push({ type: "sum", key, value });
    return this;
  }

  /**
   * Set to the maximum of current and provided value (buffered until commit)
   */
  max(key: KvKey, value: bigint): this {
    this.mutations.push({ type: "max", key, value });
    return this;
  }

  /**
   * Set to the minimum of current and provided value (buffered until commit)
   */
  min(key: KvKey, value: bigint): this {
    this.mutations.push({ type: "min", key, value });
    return this;
  }

  /**
   * Commit the transaction
   * Creates version checks for all read keys and executes all mutations atomically
   * @internal
   */
  async commit(): Promise<KvCommitError | KvCommitResult> {
    // Build checks from read cache
    const checks: KvCheck[] = [];
    for (const [keyStr, entry] of this.readCache) {
      checks.push({
        key: JSON.parse(keyStr) as KvKey,
        versionstamp: entry.versionstamp,
      });
    }

    return this.kv._commitAtomic(checks, this.mutations);
  }
}

/**
 * KeyVal client for workers/apps
 *
 * @example
 * ```typescript
 * const kv = new Kv("http://localhost:8000/_/plugin-keyval");
 *
 * // Set a value
 * await kv.set(["users", 123], { name: "Alice" });
 *
 * // Get a value
 * const entry = await kv.get(["users", 123]);
 *
 * // List by prefix
 * for await (const entry of kv.list(["users"])) {
 *   console.log(entry.key, entry.value);
 * }
 *
 * // Queue: enqueue a message
 * await kv.enqueue({ type: "email", to: "user@example.com" });
 *
 * // Queue: listen for messages
 * const listener = kv.listenQueue(async (msg) => {
 *   console.log("Processing:", msg);
 * });
 *
 * // Stop listening
 * listener.stop();
 * ```
 */
declare const window: { location?: { origin?: string } } | undefined;

/**
 * Resolve base URL - if relative path, prepend browser origin
 */
function resolveBaseUrl(baseUrl: string): string {
  if (baseUrl.startsWith("/")) {
    const origin = typeof window !== "undefined" ? window.location?.origin : undefined;
    if (origin) return `${origin}${baseUrl}`;
    throw new Error("Kv requires an absolute URL when not running in browser");
  }
  return baseUrl;
}

export class Kv {
  private baseUrl: string;
  private listeners: Map<string, AbortController> = new Map();

  constructor(baseUrl: string) {
    this.baseUrl = resolveBaseUrl(baseUrl);
  }

  /**
   * Create a placeholder for current server timestamp
   * Used in where filters to compare against server time instead of client time
   *
   * @example
   * ```typescript
   * // Delete expired sessions using server time
   * await kv.delete(["sessions"], {
   *   where: { expiresAt: { $lt: kv.now() } }
   * });
   *
   * // Delete old inactive users
   * await kv.delete(["users"], {
   *   where: {
   *     $and: [
   *       { status: "inactive" },
   *       { lastActiveAt: { $lt: kv.now() } }
   *     ]
   *   }
   * });
   * ```
   */
  now(): KvNow {
    return { [NOW_SYMBOL]: true };
  }

  /**
   * Get value(s) by key(s)
   *
   * @param keys - Single key (KvKey) or multiple keys (KvKey[])
   *
   * @example
   * ```typescript
   * // Single key
   * const entry = await kv.get(["users", 123]);
   * console.log(entry.value);
   *
   * // Multiple keys
   * const entries = await kv.get([
   *   ["users", 1],
   *   ["users", 2],
   *   ["settings", "theme"],
   * ]);
   * entries.forEach(e => console.log(e.value));
   * ```
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
      const keyArray = keys as KvKey[];

      const res = await fetch(`${this.baseUrl}/keys/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: keyArray }),
      });

      return res.json() as Promise<KvEntry<T>[]>;
    }

    // Single key
    const key = keys as KvKey;
    const keyPath = key.map(encodeKeyPart).join("/");
    const url = new URL(`${this.baseUrl}/keys/${keyPath}`);

    const res = await fetch(url.toString());

    if (res.status === 404) {
      return { key, value: null, versionstamp: null };
    }

    return res.json() as Promise<KvEntry<T>>;
  }

  /**
   * Set a key-value pair
   */
  async set<T>(
    key: KvKey,
    value: T,
    options?: KvSetOptions,
  ): Promise<{ ok: true; versionstamp: string }> {
    const keyPath = key.map(encodeKeyPart).join("/");
    const url = new URL(`${this.baseUrl}/keys/${keyPath}`);

    if (options?.expireIn) {
      url.searchParams.set("expireIn", String(options.expireIn));
    }

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });

    return res.json() as Promise<{ ok: true; versionstamp: string }>;
  }

  /**
   * Check if keys is a nested array (KvKey[]) vs single key (KvKey)
   * A KvKey is an array of primitives, KvKey[] is an array of arrays
   */
  private isNestedKeyArray(keys: KvKey | KvKey[]): boolean {
    return Array.isArray(keys) && keys.length > 0 && Array.isArray(keys[0]);
  }

  /**
   * Delete keys matching a prefix or multiple prefixes
   *
   * By default, deletes the key as a prefix (including all children).
   * Use `{ exact: true }` to delete only the exact key(s) without children.
   *
   * @param keys - Single prefix (KvKey) or multiple prefixes (KvKey[])
   * @param options - Delete options including where filter and exact mode
   *
   * Use `kv.now()` for server-side timestamp comparison to avoid client/server time discrepancies.
   *
   * @example
   * ```typescript
   * // Delete prefix (includes children)
   * // Deletes ["users", 123] AND ["users", 123, "profile"], ["users", 123, "settings"], etc.
   * const result = await kv.delete(["users", 123]);
   * console.log(`Deleted ${result.deletedCount} entries`);
   *
   * // Delete multiple prefixes
   * await kv.delete([["users", 123], ["orders", 456]]);
   *
   * // Delete exact key only (no children)
   * await kv.delete(["users", 123], { exact: true });
   *
   * // Delete expired sessions using server time
   * await kv.delete(["sessions"], {
   *   where: { expiresAt: { $lt: kv.now() } }
   * });
   *
   * // Delete with complex filter
   * await kv.delete(["users"], {
   *   where: {
   *     $or: [
   *       { status: { $eq: "inactive" } },
   *       { lastActiveAt: { $lt: kv.now() } }
   *     ]
   *   }
   * });
   * ```
   */
  async delete(keys: KvKey | KvKey[], options?: KvDeleteOptions): Promise<KvDeleteResult> {
    // Normalize keys: single key becomes array of one
    const normalizedKeys = this.isNestedKeyArray(keys) ? (keys as KvKey[]) : [keys as KvKey];
    const exact = options?.exact ?? false;

    const fetchOptions: RequestInit = { method: "DELETE" };

    // Build request body if we have options or multiple keys
    if (options?.where || normalizedKeys.length > 1 || exact) {
      fetchOptions.headers = { "Content-Type": "application/json" };
      fetchOptions.body = JSON.stringify(
        {
          keys: normalizedKeys,
          exact,
          ...(options?.where && { where: options.where }),
        },
        jsonReplacer,
      );

      const res = await fetch(`${this.baseUrl}/keys`, fetchOptions);
      return res.json() as Promise<KvDeleteResult>;
    }

    // Simple case: single prefix without options
    // normalizedKeys always has at least 1 element at this point
    const keyPath = normalizedKeys[0]!.map(encodeKeyPart).join("/");
    const res = await fetch(`${this.baseUrl}/keys/${keyPath}`, fetchOptions);
    return res.json() as Promise<KvDeleteResult>;
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
   * // With options
   * for await (const entry of kv.list(["users"], { limit: 10, reverse: true })) {
   *   console.log(entry);
   * }
   *
   * // With where filter
   * for await (const entry of kv.list(["users"], {
   *   where: { status: { $eq: "active" } }
   * })) {
   *   console.log(entry);
   * }
   *
   * // Complex filter with server timestamp
   * for await (const entry of kv.list(["sessions"], {
   *   where: {
   *     $and: [
   *       { expiresAt: { $gt: kv.now() } },
   *       { status: { $eq: "active" } }
   *     ]
   *   }
   * })) {
   *   console.log(entry);
   * }
   * ```
   */
  async *list<T = unknown>(
    prefix: KvKey,
    options: KvListOptions = {},
  ): AsyncIterableIterator<KvEntry<T>> {
    let entries: KvEntry<T>[];

    // Use POST endpoint when where filter is provided
    if (options.where) {
      const res = await fetch(`${this.baseUrl}/keys/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            prefix,
            start: options.start,
            end: options.end,
            limit: options.limit,
            reverse: options.reverse,
            where: options.where,
          },
          jsonReplacer,
        ),
      });
      entries = (await res.json()) as KvEntry<T>[];
    } else {
      // Use GET endpoint for simple queries
      const url = new URL(`${this.baseUrl}/keys`);

      if (prefix.length > 0) {
        url.searchParams.set("prefix", prefix.map(encodeKeyPart).join("/"));
      }
      if (options.start) {
        url.searchParams.set("start", options.start.map(encodeKeyPart).join("/"));
      }
      if (options.end) {
        url.searchParams.set("end", options.end.map(encodeKeyPart).join("/"));
      }
      if (options.limit) {
        url.searchParams.set("limit", String(options.limit));
      }
      if (options.reverse) {
        url.searchParams.set("reverse", "true");
      }

      const res = await fetch(url.toString());
      entries = (await res.json()) as KvEntry<T>[];
    }

    for (const entry of entries) {
      yield entry;
    }
  }

  /**
   * Count entries matching a prefix
   *
   * @example
   * ```typescript
   * const count = await kv.count(["users"]);
   * console.log(`Total users: ${count}`);
   *
   * // Count all entries
   * const total = await kv.count([]);
   * ```
   */
  async count(prefix: KvKey): Promise<number> {
    const url = new URL(`${this.baseUrl}/keys/count`);

    if (prefix.length > 0) {
      url.searchParams.set("prefix", prefix.map(encodeKeyPart).join("/"));
    }

    const res = await fetch(url.toString());
    const data = (await res.json()) as { count: number };
    return data.count;
  }

  /**
   * Paginate entries with cursor-based pagination
   *
   * Cursor pagination is more efficient than offset pagination for large datasets.
   * The cursor is an opaque string that points to the last entry of the current page.
   *
   * @param prefix - Key prefix to filter by
   * @param options - Paginate options (cursor, limit, reverse)
   *
   * @example
   * ```typescript
   * // First page
   * const page1 = await kv.paginate(["users"], { limit: 10 });
   * console.log(page1.entries);
   * console.log(`Has more: ${page1.hasMore}`);
   *
   * // Next page
   * if (page1.hasMore) {
   *   const page2 = await kv.paginate(["users"], {
   *     limit: 10,
   *     cursor: page1.cursor!,
   *   });
   * }
   *
   * // Iterate through all pages
   * let cursor: string | undefined;
   * do {
   *   const page = await kv.paginate(["users"], { limit: 100, cursor });
   *   for (const entry of page.entries) {
   *     processEntry(entry);
   *   }
   *   cursor = page.cursor ?? undefined;
   * } while (cursor);
   * ```
   */
  async paginate<T = unknown>(
    prefix: KvKey,
    options: KvPaginateOptions = {},
  ): Promise<KvPaginateResult<T>> {
    const url = new URL(`${this.baseUrl}/keys/paginate`);

    if (prefix.length > 0) {
      url.searchParams.set("prefix", prefix.map(encodeKeyPart).join("/"));
    }
    if (options.cursor) {
      url.searchParams.set("cursor", options.cursor);
    }
    if (options.limit) {
      url.searchParams.set("limit", String(options.limit));
    }
    if (options.reverse) {
      url.searchParams.set("reverse", "true");
    }

    const res = await fetch(url.toString());
    return res.json() as Promise<KvPaginateResult<T>>;
  }

  /**
   * Create an atomic operation
   */
  atomic(): KvAtomicOperation {
    return new KvAtomicOperation(this);
  }

  /**
   * Execute a function within a transaction with snapshot isolation
   *
   * The transaction provides:
   * - Read caching: All reads are cached for the duration of the transaction
   * - Write buffering: All writes are buffered until commit
   * - Optimistic concurrency: Version checks ensure no concurrent modifications
   *
   * @example
   * ```typescript
   * // Transfer money between accounts
   * const result = await kv.transaction(async (tx) => {
   *   const from = await tx.get(["accounts", fromId]);
   *   const to = await tx.get(["accounts", toId]);
   *
   *   if (!from.value || from.value.balance < amount) {
   *     throw new Error("Insufficient funds");
   *   }
   *
   *   tx.set(["accounts", fromId], { ...from.value, balance: from.value.balance - amount });
   *   tx.set(["accounts", toId], { ...to.value, balance: to.value.balance + amount });
   *
   *   return { transferred: amount };
   * }, { maxRetries: 3 });
   *
   * if (result.ok) {
   *   console.log("Transferred:", result.value.transferred);
   * }
   * ```
   */
  async transaction<T>(
    fn: (tx: KvTransaction) => Promise<T>,
    options?: KvTransactionOptions,
  ): Promise<KvTransactionError | KvTransactionResult<T>> {
    const maxRetries = options?.maxRetries ?? 0;
    const retryDelay = options?.retryDelay ?? 10;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const tx = new KvTransaction(this);
      const value = await fn(tx);
      const result = await tx.commit();

      if (result.ok) {
        return { ok: true, value, versionstamp: result.versionstamp };
      }

      // Commit failed due to version conflict, retry if possible
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
      }
    }

    return { ok: false };
  }

  /**
   * Internal method to commit atomic operations
   * Uses the /atomic endpoint for true atomic execution
   * @internal
   */
  async _commitAtomic(
    checks: KvCheck[],
    mutations: Mutation[],
  ): Promise<KvCommitError | KvCommitResult> {
    const res = await fetch(`${this.baseUrl}/atomic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        {
          checks: checks.map((c) => ({
            key: c.key,
            versionstamp: c.versionstamp,
          })),
          mutations: mutations.map((m) => ({
            type: m.type,
            key: m.key,
            value: m.value,
            expireIn: m.expireIn,
          })),
        },
        jsonReplacer,
      ),
    });

    return res.json() as Promise<KvCommitError | KvCommitResult>;
  }

  // ==========================================================================
  // FTS (Full-Text Search) Methods
  // ==========================================================================

  /**
   * Create a full-text search index on a prefix
   *
   * @param prefix - Key prefix to index
   * @param options - Index options (fields to index, tokenizer)
   *
   * @example
   * ```typescript
   * // Create index on posts with title and content fields
   * await kv.createIndex(["posts"], {
   *   fields: ["title", "content"],
   *   tokenize: "unicode61"
   * });
   *
   * // Create index on nested fields
   * await kv.createIndex(["users"], {
   *   fields: ["profile.bio", "profile.location"],
   *   tokenize: "porter"
   * });
   * ```
   */
  async createIndex(prefix: KvKey, options: KvCreateIndexOptions): Promise<void> {
    await fetch(`${this.baseUrl}/indexes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix,
        fields: options.fields,
        tokenize: options.tokenize ?? "unicode61",
      }),
    });
  }

  /**
   * Search for entries matching a query string
   *
   * @param prefix - Key prefix to search within
   * @param query - Search query string
   * @param options - Search options (limit, reverse, start, end, where)
   *
   * @example
   * ```typescript
   * // Simple search
   * for await (const entry of kv.search(["posts"], "typescript")) {
   *   console.log(entry.value.title);
   * }
   *
   * // Search with limit
   * for await (const entry of kv.search(["posts"], "react hooks", { limit: 10 })) {
   *   console.log(entry);
   * }
   *
   * // Search with where filter
   * for await (const entry of kv.search(["posts"], "database", {
   *   where: { status: "published" }
   * })) {
   *   console.log(entry);
   * }
   *
   * // Complex search with multiple conditions
   * for await (const entry of kv.search(["posts"], "javascript", {
   *   limit: 20,
   *   where: {
   *     $and: [
   *       { status: { $eq: "published" } },
   *       { views: { $gt: 100 } }
   *     ]
   *   }
   * })) {
   *   console.log(entry);
   * }
   * ```
   */
  async *search<T = unknown>(
    prefix: KvKey,
    query: string,
    options: KvSearchOptions = {},
  ): AsyncIterableIterator<KvEntry<T>> {
    const url = new URL(`${this.baseUrl}/search`);

    if (prefix.length > 0) {
      url.searchParams.set("prefix", prefix.map(encodeKeyPart).join("/"));
    }
    url.searchParams.set("query", query);
    if (options.start) {
      url.searchParams.set("start", options.start.map(encodeKeyPart).join("/"));
    }
    if (options.end) {
      url.searchParams.set("end", options.end.map(encodeKeyPart).join("/"));
    }
    if (options.limit) {
      url.searchParams.set("limit", String(options.limit));
    }
    if (options.reverse) {
      url.searchParams.set("reverse", "true");
    }

    let entries: KvEntry<T>[];

    // Use POST endpoint when where filter is provided
    if (options.where) {
      const res = await fetch(`${this.baseUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            prefix,
            query,
            start: options.start,
            end: options.end,
            limit: options.limit,
            reverse: options.reverse,
            where: options.where,
          },
          jsonReplacer,
        ),
      });
      entries = (await res.json()) as KvEntry<T>[];
    } else {
      // Use GET endpoint for simple queries
      const res = await fetch(url.toString());
      entries = (await res.json()) as KvEntry<T>[];
    }

    for (const entry of entries) {
      yield entry;
    }
  }

  /**
   * List all full-text search indexes
   *
   * @example
   * ```typescript
   * const indexes = await kv.listIndexes();
   * for (const index of indexes) {
   *   console.log("Prefix:", index.prefix);
   *   console.log("Fields:", index.fields);
   *   console.log("Tokenizer:", index.tokenize);
   * }
   * ```
   */
  async listIndexes(): Promise<KvIndex[]> {
    const res = await fetch(`${this.baseUrl}/indexes`);
    return res.json() as Promise<KvIndex[]>;
  }

  /**
   * Remove a full-text search index
   *
   * @param prefix - Key prefix of the index to remove
   *
   * @example
   * ```typescript
   * // Remove index for posts
   * await kv.removeIndex(["posts"]);
   * ```
   */
  async removeIndex(prefix: KvKey): Promise<void> {
    await fetch(`${this.baseUrl}/indexes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix }),
    });
  }

  // ==========================================================================
  // Queue Methods
  // ==========================================================================

  /**
   * Add a message to the queue
   *
   * @example
   * ```typescript
   * // Simple enqueue
   * await kv.enqueue({ type: "email", to: "user@example.com" });
   *
   * // With delay (process after 5 seconds)
   * await kv.enqueue(data, { delay: 5000 });
   *
   * // With custom retry schedule
   * await kv.enqueue(data, { backoffSchedule: [1000, 5000, 30000] });
   *
   * // With fallback keys if delivery fails
   * await kv.enqueue(data, {
   *   keysIfUndelivered: [["failed_jobs", crypto.randomUUID()]]
   * });
   * ```
   */
  async enqueue(value: unknown, options?: KvEnqueueOptions): Promise<{ ok: true; id: string }> {
    const res = await fetch(`${this.baseUrl}/queue/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, options }),
    });

    return res.json() as Promise<{ ok: true; id: string }>;
  }

  /**
   * Listen for messages from the queue
   *
   * @example
   * ```typescript
   * // SSE mode (default, low latency)
   * const handle = kv.listenQueue(async (msg) => {
   *   console.log("Processing:", msg);
   *   // If handler throws, message will be retried
   * });
   *
   * // Polling mode (better for restrictive proxies)
   * const handle = kv.listenQueue(handler, {
   *   mode: "polling",
   *   pollInterval: 2000
   * });
   *
   * // Stop listening
   * handle.stop();
   * ```
   */
  listenQueue<T = unknown>(
    handler: (value: T) => Promise<void> | void,
    options?: KvListenOptions,
  ): KvListenHandle {
    const mode = options?.mode ?? "sse";
    const listenerId = crypto.randomUUID();
    const controller = new AbortController();
    this.listeners.set(listenerId, controller);

    if (mode === "polling") {
      this.startPolling(handler, controller, options?.pollInterval ?? 1000);
    } else {
      this.startSSE(handler, controller);
    }

    const stop = () => {
      controller.abort();
      this.listeners.delete(listenerId);
    };

    return {
      stop,
      [Symbol.dispose]: stop,
    };
  }

  /**
   * Poll for queue messages
   */
  private async startPolling<T>(
    handler: (value: T) => Promise<void> | void,
    controller: AbortController,
    interval: number,
  ): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const res = await fetch(`${this.baseUrl}/queue/poll`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { message: KvQueueMessage<T> | null };

        if (data.message) {
          await this.processMessage(handler, data.message);
        } else {
          await new Promise((r) => setTimeout(r, interval));
        }
      } catch {
        if (controller.signal.aborted) break;
        // Wait before retry on error
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Listen via SSE for queue messages
   */
  private async startSSE<T>(
    handler: (value: T) => Promise<void> | void,
    controller: AbortController,
  ): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`${this.baseUrl}/queue/listen`, {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let buffer = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              currentData = line.slice(5).trim();
            } else if (line === "" && currentEvent === "message" && currentData) {
              const msg = JSON.parse(currentData) as KvQueueMessage<T>;
              await this.processMessage(handler, msg);
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } catch {
        if (controller.signal.aborted) break;
        // Reconnect after a short delay
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Process a queue message and send ack/nack
   */
  private async processMessage<T>(
    handler: (value: T) => Promise<void> | void,
    msg: KvQueueMessage<T>,
  ): Promise<void> {
    try {
      await handler(msg.value);

      // Acknowledge successful processing
      await fetch(`${this.baseUrl}/queue/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.id }),
      });
    } catch {
      // Negative acknowledge - will be retried
      await fetch(`${this.baseUrl}/queue/nack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.id }),
      });
    }
  }

  // ==========================================================================
  // Watch Methods
  // ==========================================================================

  /**
   * Watch for changes to keys matching a prefix or multiple prefixes
   *
   * By default, watches the key as a prefix (including all children).
   * Use `{ exact: true }` to watch only the exact key(s) without children.
   *
   * @param keys - Single prefix (KvKey) or multiple prefixes (KvKey[])
   * @param callback - Called when changes are detected
   * @param options - Watch options
   *
   * @example
   * ```typescript
   * // Watch a prefix (includes children)
   * const handle = kv.watch(["users", 123], (entries) => {
   *   // Receives changes to ["users", 123], ["users", 123, "profile"], etc.
   *   console.log("User changed:", entries);
   * });
   *
   * // Watch multiple prefixes
   * const handle = kv.watch(
   *   [["users", 123], ["orders", 456]],
   *   (entries) => {
   *     for (const entry of entries) {
   *       console.log("Changed:", entry.key, entry.value);
   *     }
   *   }
   * );
   *
   * // Watch exact key only (no children)
   * const handle = kv.watch(["users", 123], callback, { exact: true });
   *
   * // Polling mode (more compatible with proxies)
   * const handle = kv.watch(["users"], callback, {
   *   mode: "polling",
   *   pollInterval: 2000,
   * });
   *
   * // Stop watching
   * handle.stop();
   * ```
   */
  watch<T = unknown>(
    keys: KvKey | KvKey[],
    callback: KvWatchCallback<T>,
    options?: KvWatchOptions,
  ): KvWatchHandle {
    const mode = options?.mode ?? "sse";
    const bufferSize = options?.bufferSize ?? null;
    const overflowStrategy = options?.overflowStrategy ?? "drop-oldest";
    const exact = options?.exact ?? false;
    const watcherId = crypto.randomUUID();
    const controller = new AbortController();
    this.listeners.set(watcherId, controller);

    // Create buffer for backpressure (null means no buffering)
    const buffer = bufferSize !== null ? new WatchBuffer<T>(bufferSize, overflowStrategy) : null;

    // Normalize keys: single key becomes array of one
    const normalizedKeys = this.isNestedKeyArray(keys) ? (keys as KvKey[]) : [keys as KvKey];

    if (exact) {
      // Exact mode: watch specific keys without children
      if (mode === "polling") {
        this.startWatchExactPolling(
          normalizedKeys,
          callback,
          controller,
          options?.pollInterval ?? 1000,
          buffer,
        );
      } else {
        this.startWatchExactSSE(
          normalizedKeys,
          callback,
          controller,
          options?.emitInitial ?? true,
          buffer,
        );
      }
    } else {
      // Prefix mode: watch keys and all children
      if (mode === "polling") {
        this.startWatchPrefixPolling(
          normalizedKeys,
          callback,
          controller,
          options?.pollInterval ?? 1000,
          buffer,
        );
      } else {
        this.startWatchPrefixSSE(
          normalizedKeys,
          callback,
          controller,
          options?.emitInitial ?? true,
          options?.limit ?? 100,
          buffer,
        );
      }
    }

    const stop = () => {
      controller.abort();
      this.listeners.delete(watcherId);
    };

    return {
      stop,
      [Symbol.dispose]: stop,
    };
  }

  /**
   * Poll for exact key changes (no children)
   */
  private async startWatchExactPolling<T>(
    keys: KvKey[],
    callback: KvWatchCallback<T>,
    controller: AbortController,
    interval: number,
    buffer: WatchBuffer<T> | null,
  ): Promise<void> {
    const keysParam = keys.map((k) => k.map(encodeKeyPart).join("/")).join(",");
    let versionstamps: string[] = [];

    while (!controller.signal.aborted) {
      try {
        const url = new URL(`${this.baseUrl}/watch/poll`);
        url.searchParams.set("keys", keysParam);
        if (versionstamps.length > 0) {
          url.searchParams.set("versionstamps", versionstamps.join(","));
        }

        const res = await fetch(url.toString(), {
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          entries: KvEntry<T>[];
          versionstamps: string[];
        };

        versionstamps = data.versionstamps;

        if (data.entries.length > 0) {
          if (buffer) {
            buffer.add(data.entries);
            const bufferedEntries = buffer.flush();
            if (bufferedEntries.length > 0) {
              callback(bufferedEntries);
            }
          } else {
            callback(data.entries);
          }
        }

        await new Promise((r) => setTimeout(r, interval));
      } catch {
        if (controller.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Watch via SSE for exact key changes (no children)
   */
  private async startWatchExactSSE<T>(
    keys: KvKey[],
    callback: KvWatchCallback<T>,
    controller: AbortController,
    emitInitial: boolean,
    watchBuffer: WatchBuffer<T> | null,
  ): Promise<void> {
    const keysParam = keys.map((k) => k.map(encodeKeyPart).join("/")).join(",");

    while (!controller.signal.aborted) {
      try {
        const url = new URL(`${this.baseUrl}/watch`);
        url.searchParams.set("keys", keysParam);
        url.searchParams.set("initial", String(emitInitial));

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              currentData = line.slice(5).trim();
            } else if (line === "" && currentEvent === "change" && currentData) {
              const entries = JSON.parse(currentData) as KvEntry<T>[];
              if (watchBuffer) {
                watchBuffer.add(entries);
                const bufferedEntries = watchBuffer.flush();
                if (bufferedEntries.length > 0) {
                  callback(bufferedEntries);
                }
              } else {
                callback(entries);
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } catch {
        if (controller.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  /**
   * Poll for prefix changes (supports multiple prefixes)
   */
  private async startWatchPrefixPolling<T>(
    prefixes: KvKey[],
    callback: KvWatchCallback<T>,
    controller: AbortController,
    interval: number,
    buffer: WatchBuffer<T> | null,
  ): Promise<void> {
    const prefixesParam = prefixes.map((p) => p.map(encodeKeyPart).join("/")).join(",");
    let versionstamps = "";

    while (!controller.signal.aborted) {
      try {
        const url = new URL(`${this.baseUrl}/watch/prefix/poll`);
        url.searchParams.set("prefixes", prefixesParam);
        if (versionstamps) {
          url.searchParams.set("versionstamps", versionstamps);
        }

        const res = await fetch(url.toString(), {
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          entries: KvEntry<T>[];
          versionstamps: string;
        };

        versionstamps = data.versionstamps;

        if (data.entries.length > 0) {
          if (buffer) {
            buffer.add(data.entries);
            const bufferedEntries = buffer.flush();
            if (bufferedEntries.length > 0) {
              callback(bufferedEntries);
            }
          } else {
            callback(data.entries);
          }
        }

        await new Promise((r) => setTimeout(r, interval));
      } catch {
        if (controller.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Watch via SSE for prefix changes (supports multiple prefixes)
   */
  private async startWatchPrefixSSE<T>(
    prefixes: KvKey[],
    callback: KvWatchCallback<T>,
    controller: AbortController,
    emitInitial: boolean,
    limit: number,
    watchBuffer: WatchBuffer<T> | null,
  ): Promise<void> {
    const prefixesParam = prefixes.map((p) => p.map(encodeKeyPart).join("/")).join(",");

    while (!controller.signal.aborted) {
      try {
        const url = new URL(`${this.baseUrl}/watch/prefix`);
        url.searchParams.set("prefixes", prefixesParam);
        url.searchParams.set("initial", String(emitInitial));
        url.searchParams.set("limit", String(limit));

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        const decoder = new TextDecoder();
        let sseBuffer = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              currentData = line.slice(5).trim();
            } else if (line === "" && currentEvent === "change" && currentData) {
              const entries = JSON.parse(currentData) as KvEntry<T>[];
              if (watchBuffer) {
                watchBuffer.add(entries);
                const bufferedEntries = watchBuffer.flush();
                if (bufferedEntries.length > 0) {
                  callback(bufferedEntries);
                }
              } else {
                callback(entries);
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } catch {
        if (controller.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  // ==========================================================================
  // DLQ (Dead Letter Queue) Methods
  // ==========================================================================

  /**
   * Dead Letter Queue management
   *
   * @example
   * ```typescript
   * // List DLQ messages
   * const messages = await kv.dlq.list({ limit: 10 });
   *
   * // Get specific message
   * const msg = await kv.dlq.get("message-id");
   *
   * // Requeue a message for retry
   * await kv.dlq.requeue("message-id");
   *
   * // Delete a message
   * await kv.dlq.delete("message-id");
   *
   * // Purge all DLQ messages
   * await kv.dlq.purge();
   * ```
   */
  get dlq() {
    return {
      /**
       * List messages in the dead letter queue
       */
      list: async <T = unknown>(options?: KvDlqListOptions): Promise<KvDlqMessage<T>[]> => {
        const url = new URL(`${this.baseUrl}/queue/dlq`);
        if (options?.limit) {
          url.searchParams.set("limit", String(options.limit));
        }
        if (options?.offset) {
          url.searchParams.set("offset", String(options.offset));
        }
        const res = await fetch(url.toString());
        return res.json() as Promise<KvDlqMessage<T>[]>;
      },

      /**
       * Get a specific message from the dead letter queue
       */
      get: async <T = unknown>(id: string): Promise<KvDlqMessage<T> | null> => {
        const res = await fetch(`${this.baseUrl}/queue/dlq/${encodeURIComponent(id)}`);
        if (res.status === 404) return null;
        return res.json() as Promise<KvDlqMessage<T>>;
      },

      /**
       * Requeue a message from the dead letter queue
       */
      requeue: async (id: string): Promise<{ ok: true; id: string }> => {
        const res = await fetch(`${this.baseUrl}/queue/dlq/${encodeURIComponent(id)}/requeue`, {
          method: "POST",
        });
        return res.json() as Promise<{ ok: true; id: string }>;
      },

      /**
       * Delete a message from the dead letter queue
       */
      delete: async (id: string): Promise<void> => {
        await fetch(`${this.baseUrl}/queue/dlq/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      },

      /**
       * Purge all messages from the dead letter queue
       */
      purge: async (): Promise<void> => {
        await fetch(`${this.baseUrl}/queue/dlq`, { method: "DELETE" });
      },
    };
  }

  // ==========================================================================
  // Stats & Metrics Methods
  // ==========================================================================

  /**
   * Get queue statistics
   *
   * @example
   * ```typescript
   * const stats = await kv.queueStats();
   * console.log("Pending:", stats.pending);
   * console.log("Processing:", stats.processing);
   * console.log("DLQ:", stats.dlq);
   * ```
   */
  async queueStats(): Promise<KvQueueStats> {
    const res = await fetch(`${this.baseUrl}/queue/stats`);
    return res.json() as Promise<KvQueueStats>;
  }

  /**
   * Get operation and storage metrics
   *
   * @example
   * ```typescript
   * // JSON format (default)
   * const metrics = await kv.metrics();
   * console.log("Operations:", metrics.operations);
   * console.log("Storage:", metrics.storage);
   *
   * // Prometheus text format
   * const text = await kv.metrics("prometheus");
   * console.log(text);
   * ```
   */
  async metrics(format: "json"): Promise<KvMetrics>;
  async metrics(format: "prometheus"): Promise<string>;
  async metrics(format?: "json" | "prometheus"): Promise<KvMetrics | string>;
  async metrics(format: "json" | "prometheus" = "json"): Promise<KvMetrics | string> {
    const endpoint = format === "prometheus" ? "/metrics/prometheus" : "/metrics";
    const res = await fetch(`${this.baseUrl}${endpoint}`);
    return format === "prometheus" ? res.text() : (res.json() as Promise<KvMetrics>);
  }

  // ==========================================================================
  // Manual Queue Control Methods
  // ==========================================================================

  /**
   * Manually acknowledge a queue message
   *
   * Use this when you need fine-grained control over message acknowledgment.
   * Normally, messages are automatically acknowledged when the handler completes successfully.
   *
   * @example
   * ```typescript
   * const handle = kv.listenQueue(async (msg) => {
   *   // Process message...
   *   // Note: Use with caution - prefer automatic ack via listenQueue
   * });
   *
   * // Or manually:
   * await kv.ackMessage(messageId);
   * ```
   */
  async ackMessage(messageId: string): Promise<void> {
    await fetch(`${this.baseUrl}/queue/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: messageId }),
    });
  }

  /**
   * Manually negative acknowledge a queue message (mark for retry)
   *
   * Use this when you need fine-grained control over message acknowledgment.
   * Normally, messages are automatically nack'd when the handler throws an error.
   *
   * @example
   * ```typescript
   * // Manually mark message for retry
   * await kv.nackMessage(messageId);
   * ```
   */
  async nackMessage(messageId: string): Promise<void> {
    await fetch(`${this.baseUrl}/queue/nack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: messageId }),
    });
  }
}

/**
 * Encode a key part for URL path
 */
function encodeKeyPart(part: unknown): string {
  if (typeof part === "string") {
    return encodeURIComponent(part);
  }
  if (typeof part === "number" || typeof part === "bigint") {
    return String(part);
  }
  if (typeof part === "boolean") {
    return part ? "true" : "false";
  }
  if (part instanceof Uint8Array) {
    return Buffer.from(part).toString("base64url");
  }
  return String(part);
}
