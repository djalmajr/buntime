import type { Client } from "@libsql/client";
import { encodeKey, serializeValue } from "./encoding";
import { generateVersionstamp } from "./schema";
import type {
  KvCheck,
  KvCommitError,
  KvCommitResult,
  KvKey,
  KvMutation,
  KvSetOptions,
} from "./types";

/**
 * Atomic operation builder for KV transactions
 * Implements optimistic concurrency control using versionstamps
 */
export class AtomicOperation {
  private checks: KvCheck[] = [];
  private mutations: KvMutation[] = [];

  constructor(private client: Client) {}

  /**
   * Add a version check for a key
   * The commit will fail if the key's versionstamp doesn't match
   * Use null versionstamp to check that the key doesn't exist
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
      key,
      type: "set",
      value,
      expireIn: options?.expireIn,
    });
    return this;
  }

  /**
   * Delete a key
   */
  delete(key: KvKey): this {
    this.mutations.push({
      key,
      type: "delete",
    });
    return this;
  }

  /**
   * Commit the atomic operation
   * Returns { ok: true, versionstamp } on success
   * Returns { ok: false } if any check fails
   */
  async commit(): Promise<KvCommitError | KvCommitResult> {
    if (this.checks.length === 0 && this.mutations.length === 0) {
      return { ok: true, versionstamp: generateVersionstamp() };
    }

    // First, verify all checks
    for (const check of this.checks) {
      const encodedKey = encodeKey(check.key);

      const result = await this.client.execute({
        sql: "SELECT versionstamp FROM kv_entries WHERE key = ? AND (expires_at IS NULL OR expires_at > unixepoch())",
        args: [encodedKey],
      });

      const currentVersionstamp = result.rows[0]?.versionstamp as string | undefined;

      if (check.versionstamp === null) {
        // Check that key doesn't exist
        if (currentVersionstamp !== undefined) {
          return { ok: false };
        }
      } else {
        // Check that versionstamp matches
        if (currentVersionstamp !== check.versionstamp) {
          return { ok: false };
        }
      }
    }

    // Generate new versionstamp for this commit
    const versionstamp = generateVersionstamp();
    const now = Math.floor(Date.now() / 1000);

    // Apply all mutations
    const statements = this.mutations.map((mutation) => {
      const encodedKey = encodeKey(mutation.key);

      if (mutation.type === "delete") {
        return {
          sql: "DELETE FROM kv_entries WHERE key = ?",
          args: [encodedKey],
        };
      }

      const encodedValue = serializeValue(mutation.value);
      const expiresAt = mutation.expireIn
        ? now + Math.floor(mutation.expireIn / 1000)
        : null;

      return {
        sql: `INSERT OR REPLACE INTO kv_entries (key, value, versionstamp, expires_at)
              VALUES (?, ?, ?, ?)`,
        args: [encodedKey, encodedValue, versionstamp, expiresAt],
      };
    });

    if (statements.length > 0) {
      await this.client.batch(statements, "write");
    }

    return { ok: true, versionstamp };
  }
}
