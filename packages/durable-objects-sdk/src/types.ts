/**
 * Unique identifier for a Durable Object instance
 */
export interface DurableObjectId {
  /** Returns the string representation of this ID */
  toString(): string;
  /** Optional human-readable name (if created via idFromName) */
  name?: string;
}

/**
 * Options for listing storage entries
 */
export interface ListOptions {
  /** Only return keys starting with this prefix */
  prefix?: string;
  /** Start returning keys from this key (inclusive) */
  start?: string;
  /** Stop returning keys at this key (exclusive) */
  end?: string;
  /** Maximum number of entries to return */
  limit?: number;
  /** Return entries in reverse order */
  reverse?: boolean;
}

/**
 * Storage interface for Durable Objects
 * Provides key-value storage with transaction support
 */
export interface DurableObjectStorage {
  /**
   * Get a single value by key
   */
  get<T = unknown>(key: string): Promise<T | undefined>;

  /**
   * Get multiple values by keys
   */
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;

  /**
   * Store a single key-value pair
   */
  put<T>(key: string, value: T): Promise<void>;

  /**
   * Store multiple key-value pairs
   */
  put<T>(entries: Record<string, T>): Promise<void>;

  /**
   * Delete a single key
   * @returns true if the key existed
   */
  delete(key: string): Promise<boolean>;

  /**
   * Delete multiple keys
   * @returns number of keys deleted
   */
  delete(keys: string[]): Promise<number>;

  /**
   * List entries matching the given options
   */
  list<T = unknown>(options?: ListOptions): Promise<Map<string, T>>;

  /**
   * Execute operations atomically
   */
  transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T>;
}

/**
 * Transaction interface for atomic operations
 */
export interface DurableObjectTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): void;
  put<T>(entries: Record<string, T>): void;
  delete(key: string): void;
  delete(keys: string[]): void;
  rollback(): void;
}

/**
 * State provided to Durable Object instances
 */
export interface DurableObjectState {
  /** Unique identifier for this instance */
  id: DurableObjectId;
  /** Persistent storage for this instance */
  storage: DurableObjectStorage;
  /** In-memory state (not persisted, lost on hibernation) */
  memory: Map<string, unknown>;
}
