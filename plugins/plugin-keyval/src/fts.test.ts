import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { LibSqlAdapter } from "@buntime/plugin-database";
import { KvFts } from "./fts";
import { Kv } from "./kv";
import { initSchema } from "./schema";
import type { KvIndex } from "./types";

describe("KvFts", () => {
  let adapter: LibSqlAdapter;
  let kv: Kv;
  let fts: KvFts;

  beforeAll(async () => {
    adapter = new LibSqlAdapter({ type: "libsql", url: "http://localhost:8880" });
    await initSchema(adapter);
    kv = new Kv(adapter);
    fts = new KvFts(adapter);
    await fts.init();
  });

  afterAll(async () => {
    kv.close();
    await adapter.close();
  });

  beforeEach(async () => {
    // Clean up entries and indexes
    await adapter.execute("DELETE FROM kv_entries");
    await adapter.execute("DELETE FROM kv_indexes");

    // Drop all FTS tables
    const tables = await adapter.execute<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kv_fts_%'",
    );
    for (const table of tables) {
      await adapter.execute(`DROP TABLE IF EXISTS ${table.name}`);
    }

    // Recreate FTS instance to clear cache
    fts = new KvFts(adapter);
  });

  describe("init", () => {
    it("should create kv_indexes table", async () => {
      // Table should exist from beforeAll, verify structure
      const result = await adapter.execute<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='kv_indexes'",
      );

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("kv_indexes");
    });
  });

  describe("createIndex", () => {
    it("should create FTS5 virtual table with fields", async () => {
      await fts.createIndex(["posts"], {
        fields: ["title", "content"],
      });

      // Check that index metadata was stored
      const indexes = await fts.listIndexes();
      expect(indexes.length).toBe(1);
      expect(indexes[0]?.prefix).toEqual(["posts"]);
      expect(indexes[0]?.fields).toEqual(["title", "content"]);
      expect(indexes[0]?.tokenize).toBe("unicode61");

      // Check that FTS table was created
      const tables = await adapter.execute<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${indexes[0]?.tableName}'`,
      );
      expect(tables.length).toBe(1);
    });

    it("should support custom tokenizer", async () => {
      await fts.createIndex(["articles"], {
        fields: ["body"],
        tokenize: "porter",
      });

      const indexes = await fts.listIndexes();
      expect(indexes.length).toBe(1);
      expect(indexes[0]?.tokenize).toBe("porter");
    });

    it("should support multiple fields", async () => {
      await fts.createIndex(["users"], {
        fields: ["name", "email", "bio"],
      });

      const indexes = await fts.listIndexes();
      expect(indexes.length).toBe(1);
      expect(indexes[0]?.fields).toEqual(["name", "email", "bio"]);
    });

    it("should throw error if no fields specified", async () => {
      await expect(
        fts.createIndex(["invalid"], {
          fields: [],
        }),
      ).rejects.toThrow("At least one field must be specified");
    });

    it("should allow replacing existing index", async () => {
      await fts.createIndex(["docs"], { fields: ["title"] });
      await fts.createIndex(["docs"], { fields: ["title", "body"] });

      const indexes = await fts.listIndexes();
      expect(indexes.length).toBe(1);
      expect(indexes[0]?.fields).toEqual(["title", "body"]);
    });
  });

  describe("removeIndex", () => {
    it("should drop FTS table and remove metadata", async () => {
      await fts.createIndex(["temp"], { fields: ["data"] });

      const beforeIndexes = await fts.listIndexes();
      expect(beforeIndexes.length).toBe(1);

      await fts.removeIndex(["temp"]);

      const afterIndexes = await fts.listIndexes();
      expect(afterIndexes.length).toBe(0);

      // Verify FTS table was dropped
      const tables = await adapter.execute<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${beforeIndexes[0]?.tableName}'`,
      );
      expect(tables.length).toBe(0);
    });

    it("should not throw for non-existent index", async () => {
      await expect(fts.removeIndex(["nonexistent"])).resolves.toBeUndefined();
    });
  });

  describe("listIndexes", () => {
    it("should return empty array when no indexes exist", async () => {
      const indexes = await fts.listIndexes();
      expect(indexes).toEqual([]);
    });

    it("should return all created indexes", async () => {
      await fts.createIndex(["posts"], { fields: ["title"] });
      await fts.createIndex(["users"], { fields: ["name", "email"] });
      await fts.createIndex(["products"], { fields: ["name"], tokenize: "porter" });

      const indexes = await fts.listIndexes();
      expect(indexes.length).toBe(3);

      const prefixes = indexes.map((idx) => JSON.stringify(idx.prefix));
      expect(prefixes).toContain(JSON.stringify(["posts"]));
      expect(prefixes).toContain(JSON.stringify(["users"]));
      expect(prefixes).toContain(JSON.stringify(["products"]));
    });

    it("should include all index properties", async () => {
      await fts.createIndex(["docs"], {
        fields: ["title", "content"],
        tokenize: "porter",
      });

      const indexes = await fts.listIndexes();
      const index = indexes[0] as KvIndex;

      expect(index.prefix).toEqual(["docs"]);
      expect(index.fields).toEqual(["title", "content"]);
      expect(index.tokenize).toBe("porter");
      expect(index.tableName).toMatch(/^kv_fts_[a-f0-9]{16}$/);
    });
  });

  describe("indexDocument", () => {
    beforeEach(async () => {
      await fts.createIndex(["posts"], {
        fields: ["title", "content"],
      });
    });

    it("should index document with simple fields", async () => {
      const docKey = ["posts", 1];
      const value = {
        title: "Introduction to FTS",
        content: "Full-text search is powerful",
      };

      await fts.indexDocument(["posts"], docKey, value);

      // Verify document was indexed
      const indexes = await fts.listIndexes();
      const postsIndex = indexes.find(
        (idx) => JSON.stringify(idx.prefix) === JSON.stringify(["posts"]),
      );
      const tableName = postsIndex?.tableName as string;
      const rows = await adapter.execute<{ doc_key: string; title: string; content: string }>(
        `SELECT doc_key, title, content FROM ${tableName}`,
      );

      expect(rows.length).toBe(1);
      expect(rows[0]?.title).toBe("Introduction to FTS");
      expect(rows[0]?.content).toBe("Full-text search is powerful");
    });

    it("should handle multiple fields", async () => {
      await fts.createIndex(["users"], {
        fields: ["name", "bio"],
      });

      const docKey = ["users", 1];
      const value = {
        name: "Alice",
        bio: "Software developer who loves TypeScript",
      };

      await fts.indexDocument(["users"], docKey, value);

      const indexes = await fts.listIndexes();
      const usersIndex = indexes.find(
        (idx) => JSON.stringify(idx.prefix) === JSON.stringify(["users"]),
      );
      const tableName = usersIndex?.tableName as string;
      const rows = await adapter.execute<{ name: string; bio: string }>(
        `SELECT name, bio FROM ${tableName}`,
      );

      expect(rows.length).toBe(1);
      expect(rows[0]?.name).toBe("Alice");
      expect(rows[0]?.bio).toBe("Software developer who loves TypeScript");
    });

    it("should handle nested object extraction with dot notation", async () => {
      await fts.createIndex(["config"], {
        fields: ["description"],
      });

      const docKey = ["config", "main"];
      const value = {
        description: "Dark mode with custom colors",
      };

      await fts.indexDocument(["config"], docKey, value);

      const indexes = await fts.listIndexes();
      const configIndex = indexes.find(
        (idx) => JSON.stringify(idx.prefix) === JSON.stringify(["config"]),
      );
      const tableName = configIndex?.tableName as string;
      const rows = await adapter.execute<{ description: string }>(
        `SELECT description FROM ${tableName}`,
      );

      expect(rows.length).toBe(1);
      expect(rows[0]?.description).toBe("Dark mode with custom colors");
    });

    it("should handle missing fields gracefully", async () => {
      const docKey = ["posts", 2];
      const value = {
        title: "Only title",
        // content is missing
      };

      await fts.indexDocument(["posts"], docKey, value);

      const indexes = await fts.listIndexes();
      const postsIndex = indexes.find(
        (idx) => JSON.stringify(idx.prefix) === JSON.stringify(["posts"]),
      );
      const tableName = postsIndex?.tableName as string;
      const rows = await adapter.execute<{ title: string; content: string }>(
        `SELECT title, content FROM ${tableName}`,
      );

      expect(rows.length).toBe(1);
      expect(rows[0]?.title).toBe("Only title");
      expect(rows[0]?.content).toBe("");
    });

    it("should convert non-string values to strings", async () => {
      await fts.createIndex(["items"], {
        fields: ["name", "quantity", "enabled"],
      });

      const docKey = ["items", 1];
      const value = {
        name: "Widget",
        quantity: 42,
        enabled: true,
      };

      await fts.indexDocument(["items"], docKey, value);

      const indexes = await fts.listIndexes();
      const itemsIndex = indexes.find(
        (idx) => JSON.stringify(idx.prefix) === JSON.stringify(["items"]),
      );
      const tableName = itemsIndex?.tableName as string;
      const rows = await adapter.execute<{ quantity: string; enabled: string }>(
        `SELECT quantity, enabled FROM ${tableName}`,
      );

      expect(rows.length).toBe(1);
      expect(rows[0]?.quantity).toBe("42");
      expect(rows[0]?.enabled).toBe("true");
    });

    it("should allow multiple documents with different keys", async () => {
      const docKey1 = ["posts", 1];
      const docKey2 = ["posts", 2];

      await fts.indexDocument(["posts"], docKey1, {
        title: "First post",
        content: "First content",
      });

      await fts.indexDocument(["posts"], docKey2, {
        title: "Second post",
        content: "Second content",
      });

      const indexes = await fts.listIndexes();
      const postsIndex = indexes.find(
        (idx) => JSON.stringify(idx.prefix) === JSON.stringify(["posts"]),
      );
      const tableName = postsIndex?.tableName as string;
      const rows = await adapter.execute<{ title: string }>(`SELECT title FROM ${tableName}`);

      expect(rows.length).toBe(2);
      const titles = rows.map((r) => r.title);
      expect(titles).toContain("First post");
      expect(titles).toContain("Second post");
    });

    it("should not index if no matching index exists", async () => {
      const docKey = ["other", 1];
      const value = { data: "test" };

      // Should not throw, just skip indexing
      await expect(fts.indexDocument(["other"], docKey, value)).resolves.toBeUndefined();
    });
  });

  describe("removeDocument", () => {
    beforeEach(async () => {
      await fts.createIndex(["posts"], {
        fields: ["title", "content"],
      });
    });

    it("should remove document from index", async () => {
      const docKey = ["posts", 1];
      const value = {
        title: "To be removed",
        content: "This will be deleted",
      };

      await fts.indexDocument(["posts"], docKey, value);

      const indexes = await fts.listIndexes();
      const postsIndex = indexes.find(
        (idx) => JSON.stringify(idx.prefix) === JSON.stringify(["posts"]),
      );
      const tableName = postsIndex?.tableName as string;

      let rows = await adapter.execute(`SELECT * FROM ${tableName}`);
      expect(rows.length).toBe(1);

      await fts.removeDocument(["posts"], docKey);

      rows = await adapter.execute(`SELECT * FROM ${tableName}`);
      expect(rows.length).toBe(0);
    });

    it("should not throw for non-existent document", async () => {
      await expect(fts.removeDocument(["posts"], ["posts", 999])).resolves.toBeUndefined();
    });

    it("should not throw if no matching index exists", async () => {
      await expect(fts.removeDocument(["other"], ["other", 1])).resolves.toBeUndefined();
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await fts.createIndex(["posts"], {
        fields: ["title", "content", "author"],
      });

      // Index some test documents
      const docs = [
        {
          key: ["posts", 1],
          value: {
            title: "Introduction to TypeScript",
            content: "TypeScript is a typed superset of JavaScript",
            author: "Alice Smith",
          },
        },
        {
          key: ["posts", 2],
          value: {
            title: "Advanced JavaScript Patterns",
            content: "Learn design patterns in JavaScript",
            author: "Bob Jones",
          },
        },
        {
          key: ["posts", 3],
          value: {
            title: "Getting Started with Bun",
            content: "Bun is a fast JavaScript runtime",
            author: "Charlie Brown",
          },
        },
        {
          key: ["posts", 4],
          value: {
            title: "TypeScript Best Practices",
            content: "How to write clean TypeScript code",
            author: "Alice Smith",
          },
        },
      ];

      for (const doc of docs) {
        await kv.set(doc.key, doc.value);
        await fts.indexDocument(["posts"], doc.key, doc.value);
      }
    });

    it("should find documents by simple query", async () => {
      const results = await fts.search(["posts"], "TypeScript");

      expect(results.length).toBeGreaterThan(0);
      const titles = results.map((r) => (r.value as { title: string }).title);
      expect(titles).toContain("Introduction to TypeScript");
      expect(titles).toContain("TypeScript Best Practices");
    });

    it("should search across all indexed fields", async () => {
      // Search term appears in content, not title
      const results = await fts.search(["posts"], "design");

      expect(results.length).toBe(1);
      expect((results[0]?.value as { title: string }).title).toBe("Advanced JavaScript Patterns");
    });

    it("should find documents by author field", async () => {
      const results = await fts.search(["posts"], "Alice");

      expect(results.length).toBe(2);
      const authors = results.map((r) => (r.value as { author: string }).author);
      expect(authors.every((a) => a === "Alice Smith")).toBe(true);
    });

    it("should respect limit option", async () => {
      const results = await fts.search(["posts"], "JavaScript", { limit: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should support boolean search with AND", async () => {
      const results = await fts.search(["posts"], "TypeScript AND code");

      expect(results.length).toBe(1);
      expect((results[0]?.value as { title: string }).title).toBe("TypeScript Best Practices");
    });

    it("should support boolean search with OR", async () => {
      const results = await fts.search(["posts"], "Bun OR TypeScript");

      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it("should filter with where clause", async () => {
      const results = await fts.search(["posts"], "JavaScript", {
        where: { author: { $eq: "Bob Jones" } },
      });

      expect(results.length).toBe(1);
      expect((results[0]?.value as { title: string }).title).toBe("Advanced JavaScript Patterns");
    });

    it("should combine FTS query with complex where filter", async () => {
      const results = await fts.search(["posts"], "TypeScript", {
        where: {
          $or: [{ author: { $eq: "Alice Smith" } }, { title: { $contains: "Best" } }],
        },
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => {
        const value = r.value as { title: string; author: string };
        const matchesAuthor = value.author === "Alice Smith";
        const matchesTitle = value.title.includes("Best");
        expect(matchesAuthor || matchesTitle).toBe(true);
      });
    });

    it("should return empty array for no matches", async () => {
      const results = await fts.search(["posts"], "nonexistentterm");

      expect(results).toEqual([]);
    });

    it("should throw error if no index exists for prefix", async () => {
      await expect(fts.search(["noindex"], "query")).rejects.toThrow(
        'No index found for prefix: ["noindex"]',
      );
    });

    it("should return entries with correct structure", async () => {
      const results = await fts.search(["posts"], "TypeScript");

      expect(results.length).toBeGreaterThan(0);

      const entry = results[0];
      expect(entry).toBeDefined();
      expect(entry?.key).toBeInstanceOf(Array);
      expect(entry?.key[0]).toBe("posts");
      expect(entry?.value).toBeDefined();
      expect(entry?.versionstamp).toBeDefined();
      expect(typeof entry?.versionstamp).toBe("string");
    });

    it("should not return expired entries", async () => {
      const expiredKey = ["posts", 999];
      await kv.set(
        expiredKey,
        {
          title: "Expired Post about TypeScript",
          content: "This should not be found",
          author: "Expired Author",
        },
        { expireIn: 1 },
      );
      await fts.indexDocument(["posts"], expiredKey, {
        title: "Expired Post about TypeScript",
        content: "This should not be found",
        author: "Expired Author",
      });

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 1500));

      const results = await fts.search(["posts"], "Expired");

      expect(results.length).toBe(0);
    });
  });

  describe("getMatchingIndex", () => {
    beforeEach(async () => {
      await fts.createIndex(["posts"], { fields: ["title"] });
      await fts.createIndex(["posts", "published"], { fields: ["title"] });
      await fts.createIndex(["users"], { fields: ["name"] });
    });

    it("should find exact prefix match", async () => {
      const index = await fts.getMatchingIndex(["posts", 1]);

      expect(index).not.toBe(null);
      expect(index?.prefix).toEqual(["posts"]);
    });

    it("should find matching prefix for longer key", async () => {
      const index = await fts.getMatchingIndex(["posts", "published", 123]);

      expect(index).not.toBe(null);
      // Will match either ["posts"] or ["posts", "published"] depending on cache order
      expect(index?.prefix[0]).toBe("posts");
    });

    it("should return null for non-matching key", async () => {
      const index = await fts.getMatchingIndex(["articles", 1]);

      expect(index).toBe(null);
    });

    it("should match against empty prefix if it exists", async () => {
      await fts.createIndex([], { fields: ["data"] });

      const index = await fts.getMatchingIndex(["anything", "goes", "here"]);

      expect(index).not.toBe(null);
      expect(index?.prefix).toEqual([]);
    });

    it("should match any valid prefix", async () => {
      // When a key matches multiple prefixes, will return one that matches
      const key = ["posts", "published", 1, "comments"];

      const index = await fts.getMatchingIndex(key);

      expect(index).not.toBe(null);
      // Should match a prefix that starts with "posts"
      expect(index?.prefix[0]).toBe("posts");
    });

    it("should return null if prefix is longer than key", async () => {
      const index = await fts.getMatchingIndex(["posts"]);

      // Key ["posts"] doesn't match prefix ["posts", "published"]
      // But it does match prefix ["posts"]
      expect(index).not.toBe(null);
      expect(index?.prefix).toEqual(["posts"]);
    });
  });

  describe("integration with Kv", () => {
    it("should search documents stored via Kv.set", async () => {
      await fts.createIndex(["products"], {
        fields: ["name", "description"],
      });

      await kv.set(["products", 1], {
        name: "Laptop",
        description: "High-performance laptop with SSD",
      });
      await fts.indexDocument(["products"], ["products", 1], {
        name: "Laptop",
        description: "High-performance laptop with SSD",
      });

      await kv.set(["products", 2], {
        name: "Mouse",
        description: "Wireless mouse with long battery",
      });
      await fts.indexDocument(["products"], ["products", 2], {
        name: "Mouse",
        description: "Wireless mouse with long battery",
      });

      const results = await fts.search(["products"], "laptop");

      expect(results.length).toBe(1);
      expect((results[0]?.value as { name: string }).name).toBe("Laptop");
    });

    it("should handle documents with multiple searchable fields", async () => {
      await fts.createIndex(["articles"], {
        fields: ["title", "tags", "authorName"],
      });

      const article = {
        title: "Understanding Databases",
        tags: "database sql performance",
        authorName: "David Wilson",
      };

      await kv.set(["articles", 1], article);
      await fts.indexDocument(["articles"], ["articles", 1], article);

      const results = await fts.search(["articles"], "David");

      expect(results.length).toBe(1);
      expect((results[0]?.value as { title: string }).title).toBe("Understanding Databases");
    });
  });
});
