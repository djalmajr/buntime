import type { Duration } from "./duration";

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
 * Options for set operation
 */
export interface KvSetOptions {
  /**
   * Time to live before the key is automatically deleted
   * Accepts milliseconds (number) or string format ("1d", "2h", "30s")
   *
   * @example
   * ```typescript
   * // As milliseconds
   * await kv.set(key, value, { expiresIn: 86400000 });
   *
   * // As string (human-readable)
   * await kv.set(key, value, { expiresIn: "1d" });
   * await kv.set(key, value, { expiresIn: "24h" });
   * await kv.set(key, value, { expiresIn: "30s" });
   * ```
   */
  expiresIn?: Duration;
}

/**
 * Options for list operation
 */
export interface KvListOptions {
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
   * Return entries in reverse order
   * @default false
   */
  reverse?: boolean;
  /**
   * Start key (inclusive)
   */
  start?: KvKey;
  /**
   * Filter to apply when listing entries
   * Only entries matching the filter will be returned
   *
   * Use `kv.now()` for server-side timestamp comparison to avoid
   * client/server time discrepancies.
   *
   * @example
   * ```typescript
   * // List active users
   * for await (const entry of kv.list(["users"], {
   *   where: { status: { $eq: "active" } }
   * })) {
   *   console.log(entry);
   * }
   *
   * // List users older than 18 in SP
   * for await (const entry of kv.list(["users"], {
   *   where: {
   *     age: { $gt: 18 },
   *     city: { $eq: "SP" }
   *   }
   * })) {
   *   console.log(entry);
   * }
   *
   * // List sessions not yet expired (using server time)
   * for await (const entry of kv.list(["sessions"], {
   *   where: { expiresAt: { $gt: kv.now() } }
   * })) {
   *   console.log(entry);
   * }
   * ```
   */
  where?: KvWhereFilter;
}

/**
 * Options for paginate operation (cursor-based pagination)
 */
export interface KvPaginateOptions {
  /**
   * Cursor from previous page (base64-encoded key)
   */
  cursor?: string;
  /**
   * Maximum number of entries to return
   * @default 100
   */
  limit?: number;
  /**
   * Return entries in reverse order
   * @default false
   */
  reverse?: boolean;
}

/**
 * Result of paginate operation
 */
export interface KvPaginateResult<T = unknown> {
  /**
   * Entries in this page
   */
  entries: KvEntry<T>[];
  /**
   * Cursor to use for next page (null if no more pages)
   */
  cursor: string | null;
  /**
   * Whether there are more entries after this page
   */
  hasMore: boolean;
}

/**
 * Result of delete operation
 */
export interface KvDeleteResult {
  /**
   * Whether the operation succeeded
   */
  success: boolean;
  /**
   * Number of entries deleted (including children)
   */
  deletedCount: number;
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
   * Delay before the message becomes available
   * Accepts milliseconds (number) or string format ("1d", "2h", "30s")
   * @default 0
   *
   * @example
   * ```typescript
   * // Process after 5 seconds
   * await kv.enqueue(data, { delay: 5000 });
   * await kv.enqueue(data, { delay: "5s" });
   *
   * // Process after 1 hour
   * await kv.enqueue(data, { delay: "1h" });
   * ```
   */
  delay?: Duration;
  /**
   * Backoff schedule for retries
   * Each value is the delay before the next retry attempt
   * Accepts milliseconds (number) or string format ("1d", "2h", "30s")
   * @default [1000, 5000, 10000]
   *
   * @example
   * ```typescript
   * // Retry after 1s, 5s, then 30s
   * await kv.enqueue(data, { backoffSchedule: [1000, 5000, 30000] });
   * await kv.enqueue(data, { backoffSchedule: ["1s", "5s", "30s"] });
   * ```
   */
  backoffSchedule?: Duration[];
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
   * Whether to automatically acknowledge messages after handler completes
   * - true: Auto-ack on success, auto-nack on error (default)
   * - false: Manual control via kv.ackMessage() and kv.nackMessage()
   *
   * When autoAck is false, you MUST call ackMessage() or nackMessage()
   * for each message, otherwise messages will remain in processing state.
   *
   * @default true
   *
   * @example
   * ```typescript
   * // Auto-ack mode (default)
   * kv.listenQueue(handler);
   *
   * // Manual ack mode
   * kv.listenQueue(async (msg) => {
   *   if (processSucceeded) {
   *     await kv.ackMessage(msg.id);
   *   } else {
   *     await kv.nackMessage(msg.id);
   *   }
   * }, { autoAck: false });
   * ```
   */
  autoAck?: boolean;
  /**
   * Connection mode
   * - "sse": Server-Sent Events (default, low latency)
   * - "polling": HTTP polling (more compatible with proxies)
   * @default "sse"
   */
  mode?: "polling" | "sse";
  /**
   * Polling interval (only for mode: "polling")
   * Accepts milliseconds (number) or string format ("1s", "2s", "500ms")
   * @default 1000
   *
   * @example
   * ```typescript
   * kv.listenQueue(handler, { mode: "polling", pollInterval: 2000 });
   * kv.listenQueue(handler, { mode: "polling", pollInterval: "2s" });
   * ```
   */
  pollInterval?: Duration;
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
   * If true, watch only the exact key(s) without children
   * If false (default), watch the key(s) as prefix(es), including all children
   * @default false
   *
   * @example
   * ```typescript
   * // Watch ["users", 123] and all children (profile, settings, etc.)
   * kv.watch(["users", 123], callback);
   *
   * // Watch only ["users", 123] without children
   * kv.watch(["users", 123], callback, { exact: true });
   * ```
   */
  exact?: boolean;
  /**
   * Maximum number of entries to fetch per poll (only for prefix mode)
   * @default 100
   */
  limit?: number;
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
   * Polling interval (only for mode: "polling")
   * Accepts milliseconds (number) or string format ("1s", "2s", "500ms")
   * @default 1000
   *
   * @example
   * ```typescript
   * kv.watch(keys, callback, { mode: "polling", pollInterval: 2000 });
   * kv.watch(keys, callback, { mode: "polling", pollInterval: "2s" });
   * ```
   */
  pollInterval?: Duration;
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
   * Whether the watcher has been stopped
   */
  readonly closed: boolean;
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
// Transaction Types
// ============================================================================

/**
 * Options for transaction operation
 */
export interface KvTransactionOptions {
  /**
   * Maximum number of retries on commit failure
   * @default 0
   */
  maxRetries?: number;
  /**
   * Base delay between retries (multiplied by attempt number)
   * Accepts milliseconds (number) or string format ("10ms", "100ms", "1s")
   * @default 10
   *
   * @example
   * ```typescript
   * await kv.transaction(fn, { maxRetries: 3, retryDelay: 100 });
   * await kv.transaction(fn, { maxRetries: 3, retryDelay: "100ms" });
   * ```
   */
  retryDelay?: Duration;
}

/**
 * Result of a successful transaction
 */
export interface KvTransactionResult<T> {
  ok: true;
  value: T;
  versionstamp: string;
}

/**
 * Result of a failed transaction
 */
export interface KvTransactionError {
  ok: false;
}

// ============================================================================
// DLQ Types
// ============================================================================

/**
 * A message in the dead letter queue
 */
export interface KvDlqMessage<T = unknown> {
  /**
   * DLQ message ID
   */
  id: string;
  /**
   * Original queue message ID
   */
  originalId: string;
  /**
   * The message value
   */
  value: T;
  /**
   * Error message from last failed attempt
   */
  errorMessage: string | null;
  /**
   * Number of delivery attempts before moving to DLQ
   */
  attempts: number;
  /**
   * Original message creation timestamp (ms since epoch)
   */
  originalCreatedAt: number;
  /**
   * Timestamp when message was moved to DLQ (ms since epoch)
   */
  failedAt: number;
}

/**
 * Options for listing DLQ messages
 */
export interface KvDlqListOptions {
  /**
   * Maximum number of messages to return
   * @default 100
   */
  limit?: number;
  /**
   * Number of messages to skip
   * @default 0
   */
  offset?: number;
}

// ============================================================================
// Queue Stats Types
// ============================================================================

/**
 * Queue statistics
 */
export interface KvQueueStats {
  /**
   * Number of messages waiting to be processed
   */
  pending: number;
  /**
   * Number of messages currently being processed
   */
  processing: number;
  /**
   * Number of messages in dead letter queue
   */
  dlq: number;
  /**
   * Total number of messages (pending + processing + dlq)
   */
  total: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Operation metrics
 */
export interface KvOperationMetrics {
  /**
   * Total number of operations
   */
  count: number;
  /**
   * Number of failed operations
   */
  errors: number;
  /**
   * Average latency in milliseconds
   */
  avgLatencyMs: number;
}

/**
 * Storage statistics
 */
export interface KvStorageStats {
  /**
   * Total number of entries
   */
  entries: number;
  /**
   * Total size in bytes
   */
  sizeBytes: number;
}

/**
 * Full metrics response
 */
export interface KvMetrics {
  /**
   * Metrics for each operation type
   */
  operations: Record<string, KvOperationMetrics>;
  /**
   * Queue statistics
   */
  queue: KvQueueStats;
  /**
   * Storage statistics
   */
  storage: KvStorageStats;
}

// ============================================================================
// FTS (Full-Text Search) Types
// ============================================================================

/**
 * Tokenizer for FTS indexes
 * - "unicode61": Unicode tokenizer (default, handles most languages)
 * - "porter": Porter stemming for English
 * - "ascii": ASCII-only tokenizer
 */
export type KvFtsTokenizer = "ascii" | "porter" | "unicode61";

/**
 * Options for creating a full-text search index
 */
export interface KvCreateIndexOptions {
  /**
   * Fields to index for full-text search
   * Supports nested fields with dot notation (e.g., "user.name")
   */
  fields: string[];
  /**
   * Tokenizer to use
   * @default "unicode61"
   */
  tokenize?: KvFtsTokenizer;
}

/**
 * Options for search operation
 * Extends list options with same filtering capabilities
 */
export interface KvSearchOptions extends KvListOptions {}

/**
 * A full-text search index
 */
export interface KvIndex {
  /**
   * Fields that are indexed
   */
  fields: string[];
  /**
   * Prefix key that this index covers
   */
  prefix: KvKey;
  /**
   * Tokenizer used for this index
   */
  tokenize: string;
}

// ============================================================================
// Filter Types (for delete with where)
// ============================================================================

/**
 * Symbol used to identify now() placeholders
 * This placeholder is resolved server-side to the current timestamp
 */
export const NOW_SYMBOL = Symbol.for("kv.now");

/**
 * Placeholder for current server timestamp with optional offset
 * Created by kv.now() and resolved server-side to Date.now() + offset
 *
 * @example
 * ```typescript
 * // Current server time
 * kv.now()
 *
 * // Server time + 1 hour
 * kv.now().add("1h")
 *
 * // Server time - 24 hours
 * kv.now().sub("24h")
 * ```
 */
export interface KvNow {
  [NOW_SYMBOL]: true;
  /**
   * Offset in milliseconds from current time
   * Positive = future, Negative = past
   */
  offset?: number;
  /**
   * Add time to current timestamp
   * @param duration - Duration to add (e.g., "1h", "30m", 3600000)
   * @returns New KvNow with positive offset
   */
  add(duration: Duration): KvNow;
  /**
   * Subtract time from current timestamp
   * @param duration - Duration to subtract (e.g., "1h", "30m", 3600000)
   * @returns New KvNow with negative offset
   */
  sub(duration: Duration): KvNow;
}

/**
 * Primitive value for filter comparisons
 */
export type KvFilterValue = bigint | boolean | null | number | string;

/**
 * Filter operators for where clauses
 * Inspired by Strapi/Prisma query syntax
 *
 * Comparison operators ($gt, $gte, $lt, $lte) accept:
 * - number or string for static values
 * - KvNow ($now) for server-side current timestamp
 */
export interface KvFilterOperators {
  // ============================================================================
  // Comparison operators
  // ============================================================================

  /**
   * Equal to
   * @example { status: { $eq: "active" } }
   */
  $eq?: KvFilterValue;
  /**
   * Not equal to
   * @example { status: { $ne: "deleted" } }
   */
  $ne?: KvFilterValue;
  /**
   * Greater than
   * @example { age: { $gt: 18 } }
   * @example { createdAt: { $gt: kv.now() } } // Server timestamp
   */
  $gt?: KvNow | number | string;
  /**
   * Greater than or equal
   * @example { age: { $gte: 18 } }
   * @example { validFrom: { $gte: kv.now() } } // Server timestamp
   */
  $gte?: KvNow | number | string;
  /**
   * Less than
   * @example { price: { $lt: 100 } }
   * @example { expiresAt: { $lt: kv.now() } } // Server timestamp
   */
  $lt?: KvNow | number | string;
  /**
   * Less than or equal
   * @example { price: { $lte: 100 } }
   * @example { deadline: { $lte: kv.now() } } // Server timestamp
   */
  $lte?: KvNow | number | string;
  /**
   * Between two values (inclusive)
   * @example { amount: { $between: [100, 500] } }
   * @example { createdAt: { $between: ["2024-01-01", "2024-12-31"] } }
   */
  $between?: [number | string, number | string];

  // ============================================================================
  // Array operators
  // ============================================================================

  /**
   * Value is in array
   * @example { status: { $in: ["active", "pending"] } }
   */
  $in?: KvFilterValue[];
  /**
   * Value is not in array
   * @example { status: { $nin: ["deleted", "banned"] } }
   */
  $nin?: KvFilterValue[];

  // ============================================================================
  // String operators (case-sensitive)
  // ============================================================================

  /**
   * Contains substring (case-sensitive)
   * @example { name: { $contains: "Silva" } }
   */
  $contains?: string;
  /**
   * Does not contain substring (case-sensitive)
   * @example { email: { $notContains: "@temp" } }
   */
  $notContains?: string;
  /**
   * Starts with prefix (case-sensitive)
   * @example { code: { $startsWith: "BR_" } }
   */
  $startsWith?: string;
  /**
   * Ends with suffix (case-sensitive)
   * @example { email: { $endsWith: "@company.com" } }
   */
  $endsWith?: string;

  // ============================================================================
  // String operators (case-insensitive)
  // ============================================================================

  /**
   * Contains substring (case-insensitive)
   * @example { name: { $containsi: "silva" } }
   */
  $containsi?: string;
  /**
   * Does not contain substring (case-insensitive)
   * @example { name: { $notContainsi: "test" } }
   */
  $notContainsi?: string;
  /**
   * Starts with prefix (case-insensitive)
   * @example { code: { $startsWithi: "br_" } }
   */
  $startsWithi?: string;
  /**
   * Ends with suffix (case-insensitive)
   * @example { domain: { $endsWithi: ".com.br" } }
   */
  $endsWithi?: string;

  // ============================================================================
  // Existence operators
  // ============================================================================

  /**
   * Value is null (true) or not null (false)
   * @example { deletedAt: { $null: true } }
   */
  $null?: boolean;
  /**
   * Value is empty (empty string, empty array, or null)
   * @example { tags: { $empty: true } }
   */
  $empty?: boolean;
  /**
   * Value is not empty
   * @example { description: { $notEmpty: true } }
   */
  $notEmpty?: boolean;
}

/**
 * Where filter for delete operations
 *
 * Keys are field paths (supports nested with dot notation and array access)
 * Values are filter operators or direct values (shorthand for $eq)
 *
 * @example
 * ```typescript
 * // Simple field
 * { status: { $eq: "inactive" } }
 *
 * // Nested field
 * { "profile.verified": { $eq: true } }
 *
 * // Array access
 * { "items[0].price": { $gt: 100 } }
 *
 * // Shorthand for $eq
 * { status: "active" }
 *
 * // Logical operators
 * {
 *   $or: [
 *     { status: { $eq: "expired" } },
 *     { expiresAt: { $lt: kv.now() } }
 *   ]
 * }
 * ```
 */
export interface KvWhereFilter {
  /**
   * All conditions must be true
   */
  $and?: KvWhereFilter[];
  /**
   * At least one condition must be true
   */
  $or?: KvWhereFilter[];
  /**
   * Inverts the condition
   */
  $not?: KvWhereFilter;
  /**
   * Field path to filter value/operators
   */
  [fieldPath: string]:
    | KvFilterOperators
    | KvFilterValue
    | KvWhereFilter[]
    | KvWhereFilter
    | undefined;
}

/**
 * Options for delete operation
 */
export interface KvDeleteOptions {
  /**
   * If true, delete only the exact key without children.
   * If false (default), delete the key as a prefix including all children.
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Delete prefix (includes children) - default behavior
   * await kv.delete(["users", 123]);
   *
   * // Delete exact key only (no children)
   * await kv.delete(["users", 123], { exact: true });
   * ```
   */
  exact?: boolean;

  /**
   * Filter to apply before deleting
   * Only entries matching the filter will be deleted
   *
   * Use `kv.now()` for server-side timestamp comparison to avoid
   * client/server time discrepancies.
   *
   * @example
   * ```typescript
   * // Delete expired sessions (using server time)
   * await kv.delete(["sessions"], {
   *   where: { expiresAt: { $lt: kv.now() } }
   * });
   *
   * // Delete inactive users
   * await kv.delete(["users"], {
   *   where: {
   *     $and: [
   *       { status: { $eq: "inactive" } },
   *       { lastLogin: { $lt: kv.now() } }
   *     ]
   *   }
   * });
   * ```
   */
  where?: KvWhereFilter;
}
