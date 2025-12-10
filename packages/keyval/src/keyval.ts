import {
  COMMIT_VERSIONSTAMP_SYMBOL,
  createCommitVersionstamp,
  type KvCheck,
  type KvCommitError,
  type KvCommitResult,
  type KvCommitVersionstamp,
  type KvEnqueueOptions,
  type KvEntry,
  type KvGetOptions,
  type KvKey,
  type KvKeyPart,
  type KvKeyWithVersionstamp,
  type KvListenHandle,
  type KvListenOptions,
  type KvListOptions,
  type KvQueueMessage,
  type KvSetOptions,
  type KvWatchCallback,
  type KvWatchHandle,
  type KvWatchOptions,
  type KvWatchOverflowStrategy,
} from "./types";

/**
 * Check if a value is a commitVersionstamp placeholder
 */
function isCommitVersionstamp(value: unknown): value is KvCommitVersionstamp {
  return typeof value === "object" && value !== null && COMMIT_VERSIONSTAMP_SYMBOL in value;
}

/**
 * Check if a key contains any commitVersionstamp placeholders
 */
function hasVersionstampPlaceholder(key: KvKeyWithVersionstamp): boolean {
  return key.some(isCommitVersionstamp);
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
  key: KvKeyWithVersionstamp;
  type: MutationType;
  value?: unknown;
}

/**
 * Atomic operation builder for KV transactions
 */
export class KvAtomicOperation {
  private checks: KvCheck[] = [];
  private mutations: Mutation[] = [];
  private hasPlaceholders = false;

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
   * Key may contain commitVersionstamp placeholders that will be resolved at commit time
   *
   * @example
   * ```typescript
   * const vs = kv.commitVersionstamp();
   *
   * await kv.atomic()
   *   .set(["posts", postId], post)
   *   .set(["posts_by_time", vs, postId], postId) // vs will be resolved
   *   .commit();
   * ```
   */
  set(key: KvKeyWithVersionstamp, value: unknown, options?: KvSetOptions): this {
    if (hasVersionstampPlaceholder(key)) {
      this.hasPlaceholders = true;
    }
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
   * Key may contain commitVersionstamp placeholders that will be resolved at commit time
   */
  delete(key: KvKeyWithVersionstamp): this {
    if (hasVersionstampPlaceholder(key)) {
      this.hasPlaceholders = true;
    }
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
   *   .sum(["balance", oderId], -100n)   // Decrement by 100
   *   .commit();
   * ```
   */
  sum(key: KvKeyWithVersionstamp, value: bigint): this {
    if (hasVersionstampPlaceholder(key)) {
      this.hasPlaceholders = true;
    }
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
   *   .max(["highscore", oderId], score)
   *   .commit();
   * ```
   */
  max(key: KvKeyWithVersionstamp, value: bigint): this {
    if (hasVersionstampPlaceholder(key)) {
      this.hasPlaceholders = true;
    }
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
  min(key: KvKeyWithVersionstamp, value: bigint): this {
    if (hasVersionstampPlaceholder(key)) {
      this.hasPlaceholders = true;
    }
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
   *   .append(["logs", oderId], ["Order placed", "Payment received"])
   *   .commit();
   * ```
   */
  append(key: KvKeyWithVersionstamp, values: unknown[]): this {
    if (hasVersionstampPlaceholder(key)) {
      this.hasPlaceholders = true;
    }
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
   *   .prepend(["recent_activity", oderId], [newActivity])
   *   .commit();
   * ```
   */
  prepend(key: KvKeyWithVersionstamp, values: unknown[]): this {
    if (hasVersionstampPlaceholder(key)) {
      this.hasPlaceholders = true;
    }
    this.mutations.push({ type: "prepend", key, value: values });
    return this;
  }

  /**
   * Commit the atomic operation
   */
  async commit(): Promise<KvCommitError | KvCommitResult> {
    return this.kv._commitAtomic(this.checks, this.mutations, this.hasPlaceholders);
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
 * for await (const entry of kv.list({ prefix: ["users"] })) {
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
export class Kv {
  private listeners: Map<string, AbortController> = new Map();

  constructor(private baseUrl: string) {}

  /**
   * Get a value by key
   *
   * @param key The key to get
   * @param options Options including consistency level
   *
   * @example
   * ```typescript
   * // Strong consistency (default) - always reads from primary
   * const entry = await kv.get(["users", 123]);
   *
   * // Eventual consistency - may read from replica (lower latency)
   * const entry = await kv.get(["users", 123], { consistency: "eventual" });
   * ```
   */
  async get<T = unknown>(key: KvKey, options?: KvGetOptions): Promise<KvEntry<T>> {
    const keyPath = key.map(encodeKeyPart).join("/");
    const url = new URL(`${this.baseUrl}/keys/${keyPath}`);

    if (options?.consistency) {
      url.searchParams.set("consistency", options.consistency);
    }

    const res = await fetch(url.toString());

    if (res.status === 404) {
      return { key, value: null, versionstamp: null };
    }

    return res.json() as Promise<KvEntry<T>>;
  }

  /**
   * Get multiple values by keys in a single request
   *
   * @example
   * ```typescript
   * const entries = await kv.getMany([
   *   ["users", 1],
   *   ["users", 2],
   *   ["settings", "theme"],
   * ]);
   *
   * // With eventual consistency
   * const entries = await kv.getMany(keys, { consistency: "eventual" });
   * ```
   */
  async getMany<T = unknown>(keys: KvKey[], options?: KvGetOptions): Promise<KvEntry<T>[]> {
    if (keys.length === 0) return [];

    const res = await fetch(`${this.baseUrl}/keys/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keys,
        consistency: options?.consistency,
      }),
    });

    return res.json() as Promise<KvEntry<T>[]>;
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
   * Delete a key
   */
  async delete(key: KvKey): Promise<void> {
    const keyPath = key.map(encodeKeyPart).join("/");
    await fetch(`${this.baseUrl}/keys/${keyPath}`, { method: "DELETE" });
  }

  /**
   * List entries matching a selector
   *
   * @example
   * ```typescript
   * // Strong consistency (default)
   * for await (const entry of kv.list({ prefix: ["users"] })) {
   *   console.log(entry);
   * }
   *
   * // Eventual consistency - faster reads from replica
   * for await (const entry of kv.list({ prefix: ["users"], consistency: "eventual" })) {
   *   console.log(entry);
   * }
   * ```
   */
  async *list<T = unknown>(options: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const url = new URL(`${this.baseUrl}/keys`);

    if (options.prefix) {
      url.searchParams.set("prefix", options.prefix.map(encodeKeyPart).join("/"));
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
    if (options.consistency) {
      url.searchParams.set("consistency", options.consistency);
    }

    const res = await fetch(url.toString());
    const entries = (await res.json()) as KvEntry<T>[];

    for (const entry of entries) {
      yield entry;
    }
  }

  /**
   * Create an atomic operation
   */
  atomic(): KvAtomicOperation {
    return new KvAtomicOperation(this);
  }

  /**
   * Create a placeholder for the versionstamp that will be assigned at commit time
   * Use this to create consistent cross-references in atomic operations
   *
   * @example
   * ```typescript
   * const postId = crypto.randomUUID();
   * const vs = kv.commitVersionstamp();
   *
   * await kv.atomic()
   *   .set(["posts", postId], { title: "Hello", content: "World" })
   *   .set(["posts_by_time", vs, postId], postId) // Index by commit time
   *   .commit();
   *
   * // List posts in chronological order
   * for await (const entry of kv.list({ prefix: ["posts_by_time"] })) {
   *   console.log(entry.key); // ["posts_by_time", "00000000000000000001", "abc123"]
   * }
   * ```
   */
  commitVersionstamp(): KvCommitVersionstamp {
    return createCommitVersionstamp();
  }

  /**
   * Internal method to commit atomic operations
   * @internal
   */
  async _commitAtomic(
    checks: KvCheck[],
    mutations: Mutation[],
    hasPlaceholders: boolean,
  ): Promise<KvCommitError | KvCommitResult> {
    // For now, execute mutations sequentially
    // TODO: Implement proper atomic batch endpoint
    for (const check of checks) {
      const entry = await this.get(check.key);
      if (entry.versionstamp !== check.versionstamp) {
        return { ok: false };
      }
    }

    let lastVersionstamp = "";

    // If we have placeholders, we need to get the versionstamp first
    // then resolve all placeholders before executing mutations
    if (hasPlaceholders) {
      // Execute first non-placeholder mutation to get versionstamp
      let versionstamp = "";
      for (const mutation of mutations) {
        if (!hasVersionstampPlaceholder(mutation.key) && mutation.type === "set") {
          const result = await this.set(mutation.key as KvKey, mutation.value, {
            expireIn: mutation.expireIn,
          });
          versionstamp = result.versionstamp;
          lastVersionstamp = versionstamp;
          break;
        }
      }

      // Now resolve and execute remaining mutations
      for (const mutation of mutations) {
        const resolvedKey = mutation.key.map((part) => {
          if (isCommitVersionstamp(part)) {
            return versionstamp;
          }
          return part as KvKeyPart;
        });

        // Skip if already executed
        if (!hasVersionstampPlaceholder(mutation.key) && mutation.type === "set") {
          continue;
        }

        lastVersionstamp = await this.executeMutation(
          mutation.type,
          resolvedKey,
          mutation.value,
          mutation.expireIn,
        );
      }
    } else {
      // No placeholders, execute normally
      for (const mutation of mutations) {
        lastVersionstamp = await this.executeMutation(
          mutation.type,
          mutation.key as KvKey,
          mutation.value,
          mutation.expireIn,
        );
      }
    }

    return { ok: true, versionstamp: lastVersionstamp };
  }

  /**
   * Execute a single mutation
   * @internal
   */
  private async executeMutation(
    type: MutationType,
    key: KvKey,
    value?: unknown,
    expireIn?: number,
  ): Promise<string> {
    switch (type) {
      case "set": {
        const result = await this.set(key, value, { expireIn });
        return result.versionstamp;
      }
      case "delete": {
        await this.delete(key);
        return "";
      }
      case "sum":
      case "max":
      case "min":
      case "append":
      case "prepend": {
        // These operations need to go through the batch endpoint
        const res = await fetch(`${this.baseUrl}/atomic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mutations: [{ type, key, value, expireIn }],
          }),
        });
        const result = (await res.json()) as KvCommitResult;
        return result.versionstamp;
      }
    }
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
   * Watch for changes to one or more keys
   *
   * @example
   * ```typescript
   * // Watch a single key
   * const handle = kv.watch([["users", 123]], (entries) => {
   *   console.log("User changed:", entries[0].value);
   * });
   *
   * // Watch multiple keys
   * const handle = kv.watch(
   *   [["users", 123], ["settings", "theme"]],
   *   (entries) => {
   *     for (const entry of entries) {
   *       console.log("Changed:", entry.key, entry.value);
   *     }
   *   }
   * );
   *
   * // Polling mode (more compatible with proxies)
   * const handle = kv.watch(keys, callback, {
   *   mode: "polling",
   *   pollInterval: 2000,
   * });
   *
   * // Stop watching
   * handle.stop();
   * ```
   */
  watch<T = unknown>(
    keys: KvKey[],
    callback: KvWatchCallback<T>,
    options?: KvWatchOptions,
  ): KvWatchHandle {
    const mode = options?.mode ?? "sse";
    const bufferSize = options?.bufferSize ?? null;
    const overflowStrategy = options?.overflowStrategy ?? "drop-oldest";
    const watcherId = crypto.randomUUID();
    const controller = new AbortController();
    this.listeners.set(watcherId, controller);

    // Create buffer for backpressure (null means no buffering)
    const buffer = bufferSize !== null ? new WatchBuffer<T>(bufferSize, overflowStrategy) : null;

    if (mode === "polling") {
      this.startWatchPolling(keys, callback, controller, options?.pollInterval ?? 1000, buffer);
    } else {
      this.startWatchSSE(keys, callback, controller, options?.emitInitial ?? true, buffer);
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
   * Poll for key changes
   */
  private async startWatchPolling<T>(
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
            // Add to buffer (coalesces changes for same key)
            buffer.add(data.entries);
            // Flush buffer to callback
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
        // Wait before retry on error
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Watch via SSE for key changes
   */
  private async startWatchSSE<T>(
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
                // Add to buffer (coalesces changes for same key)
                watchBuffer.add(entries);
                // Flush buffer to callback
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
        // Reconnect after a short delay
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
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
