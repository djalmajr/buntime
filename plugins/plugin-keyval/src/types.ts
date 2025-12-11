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
   * @example
   * ```typescript
   * // List active users
   * for await (const entry of kv.list(["users"], {
   *   where: { status: { $eq: "active" } }
   * })) {
   *   console.log(entry);
   * }
   * ```
   */
  where?: KvWhereFilter;
}

/**
 * Options for paginate operation
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
 * Selector for list operation
 */
export interface KvListSelector {
  end?: KvKey;
  prefix?: KvKey;
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

/**
 * Mutation type for atomic operations
 */
export type KvMutationType = "append" | "delete" | "max" | "min" | "prepend" | "set" | "sum";

/**
 * Mutation operation for atomic operations
 */
export interface KvMutation {
  key: KvKey;
  type: KvMutationType;
  value?: unknown;
  expireIn?: number;
}

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
 * Internal queue entry stored in the database
 */
export interface KvQueueEntry {
  id: string;
  value: Uint8Array;
  readyAt: number;
  attempts: number;
  maxAttempts: number;
  backoffSchedule: string | null;
  keysIfUndelivered: string | null;
  status: "pending" | "processing" | "delivered" | "failed";
  lockedUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Transaction Types
// ============================================================================

/**
 * Options for transaction execution
 */
export interface KvTransactionOptions {
  /**
   * Maximum number of retry attempts on conflict
   * @default 0 (no retry)
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds between retries (uses exponential backoff)
   * @default 10
   */
  retryDelay?: number;
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
  error: "conflict" | "error";
  message?: string;
}

// ============================================================================
// Watch Types
// ============================================================================

/**
 * Internal state for a watch subscription
 */
export interface KvWatchState {
  /**
   * Keys being watched (encoded as hex strings for comparison)
   */
  keys: string[];
  /**
   * Last known versionstamps for each key
   */
  versionstamps: Map<string, string | null>;
}

// ============================================================================
// Trigger Types
// ============================================================================

/**
 * Event types that triggers can react to
 */
export type KvTriggerEventType = "delete" | "set";

/**
 * Configuration for a trigger
 */
export interface KvTriggerConfig<T = unknown> {
  /**
   * Key prefix to match
   * Empty array matches all keys
   */
  prefix: KvKey;
  /**
   * Event types to trigger on
   */
  events: KvTriggerEventType[];
  /**
   * Handler function called when trigger fires
   */
  handler: (event: KvTriggerEvent<T>) => Promise<void> | void;
}

/**
 * Event passed to trigger handler
 */
export interface KvTriggerEvent<T = unknown> {
  /**
   * Type of event that occurred
   */
  type: KvTriggerEventType;
  /**
   * Key that was modified
   */
  key: KvKey;
  /**
   * New value (undefined for delete events)
   */
  value?: T;
  /**
   * Versionstamp after the operation
   */
  versionstamp: string;
}

// ============================================================================
// Filter Types (for delete with where)
// ============================================================================

/**
 * Serialized $now placeholder from client
 * When JSON serialized, the Symbol-based $now becomes { "$now": true }
 */
export interface KvNowSerialized {
  $now: true;
}

/**
 * Check if a value is a serialized $now placeholder
 */
export function isNowPlaceholder(value: unknown): value is KvNowSerialized {
  return (
    typeof value === "object" &&
    value !== null &&
    "$now" in value &&
    (value as KvNowSerialized).$now === true
  );
}

/**
 * Primitive value for filter comparisons
 */
export type KvFilterValue = bigint | boolean | null | number | string;

/**
 * Filter operators for where clauses
 * Comparison operators can accept KvNowSerialized for server-side timestamp
 */
export interface KvFilterOperators {
  // Comparison operators
  /** Equal to */
  $eq?: KvFilterValue;
  /** Not equal to */
  $ne?: KvFilterValue;
  /** Greater than */
  $gt?: KvNowSerialized | number | string;
  /** Greater than or equal to */
  $gte?: KvNowSerialized | number | string;
  /** Less than */
  $lt?: KvNowSerialized | number | string;
  /** Less than or equal to */
  $lte?: KvNowSerialized | number | string;
  /** Between two values (inclusive): [min, max] */
  $between?: [number | string, number | string];

  // Array operators
  /** Value is in array */
  $in?: KvFilterValue[];
  /** Value is not in array */
  $nin?: KvFilterValue[];

  // String operators (case-sensitive)
  /** Contains substring */
  $contains?: string;
  /** Does not contain substring */
  $notContains?: string;
  /** Starts with prefix */
  $startsWith?: string;
  /** Ends with suffix */
  $endsWith?: string;

  // String operators (case-insensitive)
  /** Contains substring (case-insensitive) */
  $containsi?: string;
  /** Does not contain substring (case-insensitive) */
  $notContainsi?: string;
  /** Starts with prefix (case-insensitive) */
  $startsWithi?: string;
  /** Ends with suffix (case-insensitive) */
  $endsWithi?: string;

  // Existence operators
  /** Value is null (true) or not null (false) */
  $null?: boolean;
  /** Value is empty (empty string or empty array) */
  $empty?: boolean;
  /** Value is not empty */
  $notEmpty?: boolean;
}

/**
 * Where filter for delete operations
 */
export interface KvWhereFilter {
  $and?: KvWhereFilter[];
  $or?: KvWhereFilter[];
  $not?: KvWhereFilter;
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
  where?: KvWhereFilter;
}

// ============================================================================
// Queue Listener Types
// ============================================================================

/**
 * Configuration for queue listener
 */
export interface KvQueueListenerConfig<T = unknown> {
  /**
   * Handler function called for each message
   * If handler completes without error, message is automatically acked
   * If handler throws, message is automatically nacked
   */
  handler: (msg: KvQueueMessage<T>) => Promise<void> | void;
  /**
   * Optional error handler called when handler throws
   */
  onError?: (error: Error, msg: KvQueueMessage<T>) => void;
  /**
   * Number of messages to process concurrently
   * @default 1
   */
  concurrency?: number;
  /**
   * Interval in milliseconds between polling for new messages
   * @default 1000
   */
  pollInterval?: number;
}

// ============================================================================
// Full-Text Search Types
// ============================================================================

/**
 * FTS5 tokenizer options
 */
export type KvFtsTokenizer = "ascii" | "porter" | "unicode61";

/**
 * Options for creating a full-text search index
 */
export interface KvCreateIndexOptions {
  /**
   * Fields to index (JSON paths like "title", "content", "user.name")
   */
  fields: string[];
  /**
   * FTS5 tokenizer to use
   * @default "unicode61"
   */
  tokenize?: KvFtsTokenizer;
}

/**
 * Full-text search index metadata
 */
export interface KvIndex {
  /**
   * Fields being indexed
   */
  fields: string[];
  /**
   * Key prefix this index applies to
   */
  prefix: KvKey;
  /**
   * FTS table name (derived from prefix hash)
   */
  tableName: string;
  /**
   * Tokenizer being used
   */
  tokenize: KvFtsTokenizer;
}

/**
 * Options for full-text search
 */
export interface KvSearchOptions {
  /**
   * Consistency level for the read operation
   * @default "strong"
   */
  consistency?: KvConsistency;
  /**
   * Maximum number of results to return
   * @default 100
   */
  limit?: number;
  /**
   * Additional filter to apply on KV data after FTS match
   */
  where?: KvWhereFilter;
}
