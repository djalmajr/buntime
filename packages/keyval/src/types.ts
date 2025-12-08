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
