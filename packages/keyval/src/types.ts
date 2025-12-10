/**
 * A key part can be a string, number, bigint, boolean, or Uint8Array
 * Keys are ordered lexicographically by type, then by value
 */
export type KvKeyPart = bigint | boolean | number | string | Uint8Array;

/**
 * A key is an array of key parts
 * Example: ["users", 42, "profile"]
 */
export type KvKey = KvKeyPart[];

/**
 * Result of a get operation
 */
export interface KvEntry<T = unknown> {
  key: KvKey;
  value: T | null;
  versionstamp: string | null;
}

/**
 * Consistency level for read operations
 * - "strong": Always read from primary (default, guaranteed latest value)
 * - "eventual": May read from replica (lower latency, possibly stale)
 */
export type KvConsistency = "eventual" | "strong";

/**
 * Options for get operation
 */
export interface KvGetOptions {
  /**
   * Consistency level for the read operation
   * @default "strong"
   */
  consistency?: KvConsistency;
}

/**
 * Options for set operation
 */
export interface KvSetOptions {
  /**
   * Time to live in milliseconds
   * After this time, the key will be automatically deleted
   */
  expireIn?: number;
}

/**
 * Options for list operation
 */
export interface KvListOptions {
  /**
   * Consistency level for the read operation
   * @default "strong"
   */
  consistency?: KvConsistency;
  /**
   * End key (exclusive)
   */
  end?: KvKey;
  /**
   * Maximum number of entries to return
   * @default 100
   */
  limit?: number;
  /**
   * Key prefix to filter by
   */
  prefix?: KvKey;
  /**
   * Return entries in reverse order
   * @default false
   */
  reverse?: boolean;
  /**
   * Start key (inclusive)
   */
  start?: KvKey;
}

/**
 * Result of a commit operation
 */
export interface KvCommitResult {
  ok: true;
  versionstamp: string;
}

/**
 * Result of a failed commit operation
 */
export interface KvCommitError {
  ok: false;
}

/**
 * Check condition for atomic operations
 */
export interface KvCheck {
  key: KvKey;
  versionstamp: string | null;
}

// ============================================================================
// Queue Types
// ============================================================================

/**
 * Options for enqueue operation
 */
export interface KvEnqueueOptions {
  /**
   * Delay in milliseconds before the message becomes available
   * @default 0
   */
  delay?: number;
  /**
   * Backoff schedule in milliseconds for retries
   * @default [1000, 5000, 10000]
   */
  backoffSchedule?: number[];
  /**
   * Keys to set the message value if delivery fails after all retries
   */
  keysIfUndelivered?: KvKey[];
}

/**
 * A message from the queue
 */
export interface KvQueueMessage<T = unknown> {
  /**
   * Unique message ID
   */
  id: string;
  /**
   * The message value
   */
  value: T;
  /**
   * Number of delivery attempts
   */
  attempts: number;
}

/**
 * Options for listenQueue
 */
export interface KvListenOptions {
  /**
   * Connection mode
   * - "sse": Server-Sent Events (default, low latency)
   * - "polling": HTTP polling (more compatible with proxies)
   * @default "sse"
   */
  mode?: "polling" | "sse";
  /**
   * Polling interval in milliseconds (only for mode: "polling")
   * @default 1000
   */
  pollInterval?: number;
}

/**
 * Handle returned by listenQueue to control the listener
 * Implements Symbol.dispose for use with `using` keyword
 *
 * @example
 * ```typescript
 * // Manual cleanup
 * const handle = kv.listenQueue(handler);
 * // ... later
 * handle.stop();
 *
 * // Automatic cleanup with `using`
 * {
 *   using listener = kv.listenQueue(handler);
 *   await processMessages();
 * } // listener.stop() called automatically
 * ```
 */
export interface KvListenHandle extends Disposable {
  /**
   * Stop listening to the queue
   */
  stop: () => void;
}

// ============================================================================
// Watch Types
// ============================================================================

/**
 * Overflow strategy when buffer is full
 * - "drop-oldest": Remove oldest entries to make room (default)
 * - "drop-newest": Ignore new entries when buffer is full
 */
export type KvWatchOverflowStrategy = "drop-newest" | "drop-oldest";

/**
 * Options for watch operation
 */
export interface KvWatchOptions {
  /**
   * Maximum number of entries to buffer before applying overflow strategy
   * When null or undefined, no backpressure is applied (unlimited buffer)
   * @default null (no limit)
   */
  bufferSize?: number | null;
  /**
   * If true, immediately emit the current value when starting to watch
   * @default true
   */
  emitInitial?: boolean;
  /**
   * Connection mode
   * - "sse": Server-Sent Events (default, lower latency)
   * - "polling": HTTP polling (more compatible with proxies)
   * @default "sse"
   */
  mode?: "polling" | "sse";
  /**
   * Strategy when buffer is full
   * - "drop-oldest": Remove oldest entries to make room (default)
   * - "drop-newest": Ignore new entries when buffer is full
   * @default "drop-oldest"
   */
  overflowStrategy?: KvWatchOverflowStrategy;
  /**
   * Polling interval in milliseconds (only for mode: "polling")
   * @default 1000
   */
  pollInterval?: number;
}

/**
 * Handle returned by watch to control the watcher
 * Implements Symbol.dispose for use with `using` keyword
 *
 * @example
 * ```typescript
 * // Manual cleanup
 * const handle = kv.watch(keys, callback);
 * // ... later
 * handle.stop();
 *
 * // Automatic cleanup with `using`
 * {
 *   using watcher = kv.watch(keys, callback);
 *   await waitForCondition();
 * } // watcher.stop() called automatically
 * ```
 */
export interface KvWatchHandle extends Disposable {
  /**
   * Stop watching
   */
  stop: () => void;
}

/**
 * Callback for watch operation
 */
export type KvWatchCallback<T> = (entries: KvEntry<T>[]) => void;

// ============================================================================
// Commit Versionstamp Types
// ============================================================================

/**
 * Symbol used to identify commitVersionstamp placeholders
 */
export const COMMIT_VERSIONSTAMP_SYMBOL = Symbol.for("kv.commitVersionstamp");

/**
 * Placeholder for a versionstamp that will be resolved at commit time
 * Used in atomic operations to create consistent cross-references
 *
 * @example
 * ```typescript
 * const vs = kv.commitVersionstamp();
 *
 * await kv.atomic()
 *   .set(["posts", postId], post)
 *   .set(["posts_by_time", vs, postId], postId)
 *   .commit();
 * ```
 */
export interface KvCommitVersionstamp {
  [COMMIT_VERSIONSTAMP_SYMBOL]: true;
}

/**
 * A key part that may include a commitVersionstamp placeholder
 * Used in atomic operations
 */
export type KvKeyPartWithVersionstamp = KvCommitVersionstamp | KvKeyPart;

/**
 * A key that may include commitVersionstamp placeholders
 * Used in atomic operations
 */
export type KvKeyWithVersionstamp = KvKeyPartWithVersionstamp[];

/**
 * Create a commitVersionstamp placeholder
 */
export function createCommitVersionstamp(): KvCommitVersionstamp {
  return { [COMMIT_VERSIONSTAMP_SYMBOL]: true };
}
