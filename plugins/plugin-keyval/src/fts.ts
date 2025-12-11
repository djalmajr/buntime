import { createHash } from "node:crypto";
import type { DatabaseAdapter } from "@buntime/plugin-database";
import { decodeKey, deserializeValue, encodeKey } from "./encoding";
import type { KvCreateIndexOptions, KvEntry, KvIndex, KvKey, KvSearchOptions } from "./types";
import { whereToSql } from "./where-to-sql";

/**
 * Full-Text Search manager for KeyVal
 * Handles FTS5 index creation, indexing, and search
 */
export class KvFts {
  /** Cache of indexes loaded from database */
  private indexCache: Map<string, KvIndex> = new Map();
  /** Whether indexes have been loaded */
  private indexesLoaded = false;

  constructor(private adapter: DatabaseAdapter) {}

  /**
   * Initialize FTS system by creating metadata table
   */
  async init(): Promise<void> {
    await this.adapter.execute(
      `CREATE TABLE IF NOT EXISTS kv_indexes (
        prefix BLOB PRIMARY KEY,
        fields TEXT NOT NULL,
        tokenize TEXT DEFAULT 'unicode61',
        created_at INTEGER NOT NULL
      )`,
    );
  }

  /**
   * Create a full-text search index for a key prefix
   *
   * @example
   * ```typescript
   * await fts.createIndex(["posts"], {
   *   fields: ["title", "content", "author.name"],
   *   tokenize: "unicode61"
   * });
   * ```
   */
  async createIndex(prefix: KvKey, options: KvCreateIndexOptions): Promise<void> {
    const { fields, tokenize = "unicode61" } = options;

    if (fields.length === 0) {
      throw new Error("At least one field must be specified");
    }

    const encodedPrefix = encodeKey(prefix);
    const tableName = this.getTableName(prefix);
    const now = Math.floor(Date.now() / 1000);

    // Create FTS5 virtual table with doc_key and all specified fields
    const fieldList = ["doc_key", ...fields].join(", ");
    await this.adapter.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING fts5(
        ${fieldList},
        tokenize='${tokenize}'
      )`,
    );

    // Store index metadata
    await this.adapter.execute(
      `INSERT OR REPLACE INTO kv_indexes (prefix, fields, tokenize, created_at)
       VALUES (?, ?, ?, ?)`,
      [encodedPrefix, JSON.stringify(fields), tokenize, now],
    );

    // Update cache
    this.indexCache.set(Buffer.from(encodedPrefix).toString("hex"), {
      fields,
      prefix,
      tableName,
      tokenize,
    });
  }

  /**
   * Remove a full-text search index
   */
  async removeIndex(prefix: KvKey): Promise<void> {
    const encodedPrefix = encodeKey(prefix);
    const tableName = this.getTableName(prefix);

    // Drop FTS table
    await this.adapter.execute(`DROP TABLE IF EXISTS ${tableName}`);

    // Remove metadata
    await this.adapter.execute(`DELETE FROM kv_indexes WHERE prefix = ?`, [encodedPrefix]);

    // Update cache
    this.indexCache.delete(Buffer.from(encodedPrefix).toString("hex"));
  }

  /**
   * List all indexes
   */
  async listIndexes(): Promise<KvIndex[]> {
    const rows = await this.adapter.execute<{
      fields: string;
      prefix: Uint8Array | ArrayBuffer;
      tokenize: string;
    }>(`SELECT prefix, fields, tokenize FROM kv_indexes`);

    return rows.map((row) => {
      const prefixBytes =
        row.prefix instanceof Uint8Array ? row.prefix : new Uint8Array(row.prefix as ArrayBuffer);
      const prefix = decodeKey(prefixBytes);
      return {
        fields: JSON.parse(row.fields) as string[],
        prefix,
        tableName: this.getTableName(prefix),
        tokenize: row.tokenize as "ascii" | "porter" | "unicode61",
      };
    });
  }

  /**
   * Index a document when it's set in KV
   */
  async indexDocument(_prefix: KvKey, docKey: KvKey, value: unknown): Promise<void> {
    const index = await this.getMatchingIndex(docKey);
    if (!index) return;

    // Extract field values from document
    const fieldValues: unknown[] = [this.encodeDocKey(docKey)];

    for (const field of index.fields) {
      const fieldValue = this.extractField(value, field);
      fieldValues.push(fieldValue ?? "");
    }

    // Insert into FTS table
    const placeholders = fieldValues.map(() => "?").join(", ");
    await this.adapter.execute(
      `INSERT OR REPLACE INTO ${index.tableName} VALUES (${placeholders})`,
      fieldValues,
    );
  }

  /**
   * Remove a document from the index when it's deleted
   */
  async removeDocument(_prefix: KvKey, docKey: KvKey): Promise<void> {
    const index = await this.getMatchingIndex(docKey);
    if (!index) return;

    const encodedDocKey = this.encodeDocKey(docKey);
    await this.adapter.execute(`DELETE FROM ${index.tableName} WHERE doc_key = ?`, [encodedDocKey]);
  }

  /**
   * Search for documents using FTS5
   *
   * @param prefix - Key prefix to search within
   * @param query - FTS5 query string (supports AND, OR, NOT, NEAR, etc.)
   * @param options - Search options (limit, where filter, consistency)
   *
   * @example
   * ```typescript
   * // Simple search
   * const results = await fts.search(["posts"], "javascript tutorial");
   *
   * // Boolean search
   * const results = await fts.search(["posts"], "javascript AND (tutorial OR guide)");
   *
   * // With additional filter
   * const results = await fts.search(["posts"], "javascript", {
   *   where: { status: { $eq: "published" } },
   *   limit: 50
   * });
   * ```
   */
  async search<T = unknown>(
    prefix: KvKey,
    query: string,
    options?: KvSearchOptions,
  ): Promise<KvEntry<T>[]> {
    const { limit = 100, where } = options ?? {};

    // Find matching index
    const index = this.indexCache.get(Buffer.from(encodeKey(prefix)).toString("hex"));
    if (!index) {
      throw new Error(`No index found for prefix: ${JSON.stringify(prefix)}`);
    }

    // Build FTS query - search across all indexed fields
    // FTS5 syntax: field1:query OR field2:query ...
    const fieldQueries = index.fields.map((field) => `${field}:${query}`).join(" OR ");

    // Execute FTS search to get doc_keys
    const ftsRows = await this.adapter.execute<{ doc_key: string }>(
      `SELECT doc_key FROM ${index.tableName} WHERE ${index.tableName} MATCH ? LIMIT ?`,
      [fieldQueries, limit],
    );

    if (ftsRows.length === 0) {
      return [];
    }

    // Get full entries from kv_entries
    const docKeys = ftsRows.map((row) => this.decodeDocKey(row.doc_key));
    const encodedKeys = docKeys.map(encodeKey);
    const placeholders = encodedKeys.map(() => "?").join(", ");

    let sql = `SELECT key, value, versionstamp FROM kv_entries
               WHERE key IN (${placeholders})
               AND (expires_at IS NULL OR expires_at > unixepoch())`;
    const args: unknown[] = [...encodedKeys];

    // Apply where filter if provided
    if (where) {
      const whereResult = whereToSql(where);
      sql += ` AND ${whereResult.sql}`;
      args.push(...whereResult.params);
    }

    const rows = await this.adapter.execute<{
      key: Uint8Array | ArrayBuffer;
      value: unknown;
      versionstamp: string;
    }>(sql, args);

    // Convert to KvEntry format
    return rows.map((row) => {
      const keyBytes =
        row.key instanceof Uint8Array ? row.key : new Uint8Array(row.key as ArrayBuffer);
      return {
        key: decodeKey(keyBytes),
        value: deserializeValue<T>(row.value),
        versionstamp: row.versionstamp,
      };
    });
  }

  /**
   * Get the index that matches a given key (if any)
   */
  async getMatchingIndex(key: KvKey): Promise<KvIndex | null> {
    // Load indexes on first use
    if (!this.indexesLoaded) {
      await this.loadIndexes();
    }

    // Check each index to see if key matches its prefix
    for (const index of this.indexCache.values()) {
      if (this.keyMatchesPrefix(key, index.prefix)) {
        return index;
      }
    }

    return null;
  }

  /**
   * Check if a key matches a prefix
   */
  private keyMatchesPrefix(key: KvKey, prefix: KvKey): boolean {
    if (prefix.length === 0) return true;
    if (prefix.length > key.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (key[i] !== prefix[i]) return false;
    }
    return true;
  }

  /**
   * Load all indexes from database into cache
   */
  private async loadIndexes(): Promise<void> {
    const indexes = await this.listIndexes();
    this.indexCache.clear();

    for (const index of indexes) {
      const key = Buffer.from(encodeKey(index.prefix)).toString("hex");
      this.indexCache.set(key, index);
    }

    this.indexesLoaded = true;
  }

  /**
   * Generate FTS table name from prefix using hash
   */
  private getTableName(prefix: KvKey): string {
    const encoded = encodeKey(prefix);
    const hash = createHash("sha256").update(encoded).digest("hex").substring(0, 16);
    return `kv_fts_${hash}`;
  }

  /**
   * Encode doc key as string for FTS storage
   */
  private encodeDocKey(key: KvKey): string {
    return Buffer.from(encodeKey(key)).toString("hex");
  }

  /**
   * Decode doc key from FTS storage
   */
  private decodeDocKey(encoded: string): KvKey {
    return decodeKey(Buffer.from(encoded, "hex"));
  }

  /**
   * Extract a field value from a document using JSON path
   * Supports simple paths like "title" and nested paths like "user.name"
   */
  private extractField(doc: unknown, field: string): string | null {
    if (typeof doc !== "object" || doc === null) {
      return null;
    }

    const parts = field.split(".");
    let current: unknown = doc;

    for (const part of parts) {
      if (typeof current !== "object" || current === null) {
        return null;
      }
      current = (current as Record<string, unknown>)[part];
    }

    // Convert to string for indexing
    if (current === null || current === undefined) {
      return null;
    }
    if (typeof current === "string") {
      return current;
    }
    if (typeof current === "number" || typeof current === "boolean") {
      return String(current);
    }
    // For objects/arrays, JSON stringify
    return JSON.stringify(current);
  }
}
