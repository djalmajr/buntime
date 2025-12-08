import type {
  KvCheck,
  KvCommitError,
  KvCommitResult,
  KvEntry,
  KvKey,
  KvListOptions,
  KvSetOptions,
} from "./types";

/**
 * Atomic operation builder for KV transactions
 */
export class KvAtomicOperation {
  private checks: KvCheck[] = [];
  private mutations: Array<{
    type: "set" | "delete";
    key: KvKey;
    value?: unknown;
    expireIn?: number;
  }> = [];

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
   * Commit the atomic operation
   */
  async commit(): Promise<KvCommitError | KvCommitResult> {
    return this.kv._commitAtomic(this.checks, this.mutations);
  }
}

/**
 * KeyVal client for workers/apps
 *
 * @example
 * ```typescript
 * const kv = new Kv("http://localhost:3000/_/plugin-keyval");
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
 * ```
 */
export class Kv {
  constructor(private baseUrl: string) {}

  /**
   * Get a value by key
   */
  async get<T = unknown>(key: KvKey): Promise<KvEntry<T>> {
    const keyPath = key.map(encodeKeyPart).join("/");
    const res = await fetch(`${this.baseUrl}/keys/${keyPath}`);

    if (res.status === 404) {
      return { key, value: null, versionstamp: null };
    }

    return res.json() as Promise<KvEntry<T>>;
  }

  /**
   * Get multiple values by keys
   */
  async getMany<T = unknown>(keys: KvKey[]): Promise<KvEntry<T>[]> {
    return Promise.all(keys.map((key) => this.get<T>(key)));
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
   */
  async *list<T = unknown>(options: KvListOptions): AsyncIterableIterator<KvEntry<T>> {
    const url = new URL(`${this.baseUrl}/keys`);

    if (options.prefix) {
      url.searchParams.set("prefix", options.prefix.map(encodeKeyPart).join("/"));
    }
    if (options.limit) {
      url.searchParams.set("limit", String(options.limit));
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
   * Internal method to commit atomic operations
   * @internal
   */
  async _commitAtomic(
    checks: KvCheck[],
    mutations: Array<{
      type: "set" | "delete";
      key: KvKey;
      value?: unknown;
      expireIn?: number;
    }>,
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
    for (const mutation of mutations) {
      if (mutation.type === "set") {
        const result = await this.set(mutation.key, mutation.value, {
          expireIn: mutation.expireIn,
        });
        lastVersionstamp = result.versionstamp;
      } else {
        await this.delete(mutation.key);
      }
    }

    return { ok: true, versionstamp: lastVersionstamp };
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
