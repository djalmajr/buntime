import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { KvFts } from "./fts";
import { Kv } from "./kv";
import { initSchema } from "./schema";
import { createTestAdapter } from "./test-helpers";

describe("Full-Text Search", () => {
  const adapter = createTestAdapter();
  let kv: Kv;
  let fts: KvFts;

  async function cleanupFts() {
    // Clean up any orphaned FTS tables
    const tables = await adapter.execute<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kv_fts_%'",
    );
    for (const table of tables) {
      await adapter.execute(`DROP TABLE IF EXISTS ${table.name}`);
    }
    await adapter.execute("DELETE FROM kv_indexes");
  }

  beforeAll(async () => {
    await initSchema(adapter);
    kv = new Kv(adapter);
  });

  afterAll(async () => {
    kv.close();
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.execute("DELETE FROM kv_entries");
    await cleanupFts();
    // Recreate FTS manager to reset internal cache
    fts = new KvFts(adapter);
    await fts.init();
  });

  // ==========================================================================
  // Index Management
  // ==========================================================================

  describe("createIndex", () => {
    it("should create an index for a prefix", async () => {
      await fts.createIndex(["idx_posts"], {
        fields: ["title", "content"],
        tokenize: "unicode61",
      });

      const indexes = await fts.listIndexes();
      expect(indexes.length).toBe(1);
      expect(indexes[0]?.prefix).toEqual(["idx_posts"]);
      expect(indexes[0]?.fields).toEqual(["title", "content"]);
      expect(indexes[0]?.tokenize).toBe("unicode61");
    });

    it("should support different tokenizers", async () => {
      await fts.createIndex(["idx_english"], {
        fields: ["text"],
        tokenize: "porter",
      });

      await fts.createIndex(["idx_simple"], {
        fields: ["text"],
        tokenize: "ascii",
      });

      const indexes = await fts.listIndexes();
      const english = indexes.find((i) => i.prefix[0] === "idx_english");
      const simple = indexes.find((i) => i.prefix[0] === "idx_simple");

      expect(english?.tokenize).toBe("porter");
      expect(simple?.tokenize).toBe("ascii");
    });

    it("should throw error for empty fields", async () => {
      await expect(
        fts.createIndex(["idx_posts"], {
          fields: [],
        }),
      ).rejects.toThrow("At least one field must be specified");
    });
  });

  describe("removeIndex", () => {
    it("should remove an existing index", async () => {
      await fts.createIndex(["rm_posts"], {
        fields: ["title"],
      });

      let indexes = await fts.listIndexes();
      expect(indexes.length).toBe(1);

      await fts.removeIndex(["rm_posts"]);

      indexes = await fts.listIndexes();
      expect(indexes.length).toBe(0);
    });
  });

  describe("listIndexes", () => {
    it("should return empty array when no indexes", async () => {
      const indexes = await fts.listIndexes();
      expect(indexes).toEqual([]);
    });

    it("should return all indexes", async () => {
      await fts.createIndex(["list_posts"], { fields: ["title"] });
      await fts.createIndex(["list_users"], { fields: ["name", "bio"] });
      await fts.createIndex(["list_products"], { fields: ["name", "description"] });

      const indexes = await fts.listIndexes();
      expect(indexes.length).toBe(3);
    });
  });

  // ==========================================================================
  // Document Indexing
  // ==========================================================================

  describe("indexDocument", () => {
    it("should index a document on set", async () => {
      await fts.createIndex(["doc_posts"], {
        fields: ["title", "content"],
      });

      const post = {
        title: "JavaScript Tutorial",
        content: "Learn JavaScript programming",
      };

      await kv.set(["doc_posts", 1], post);
      await fts.indexDocument(["doc_posts"], ["doc_posts", 1], post);

      const results = await fts.search(["doc_posts"], "JavaScript");
      expect(results.length).toBe(1);
      expect(results[0]?.value).toEqual(post);
    });

    it("should handle null/undefined fields gracefully", async () => {
      await fts.createIndex(["null_posts"], {
        fields: ["title", "content"],
      });

      const post = {
        title: "Post without content",
        content: null,
      };

      await kv.set(["null_posts", 1], post);
      await fts.indexDocument(["null_posts"], ["null_posts", 1], post);

      const results = await fts.search(["null_posts"], "without");
      expect(results.length).toBe(1);
    });
  });

  describe("removeDocument", () => {
    it("should remove document from index", async () => {
      await fts.createIndex(["rmdoc_posts"], {
        fields: ["title", "content"],
      });

      const post = { title: "Test Post", content: "Content here" };

      await kv.set(["rmdoc_posts", 1], post);
      await fts.indexDocument(["rmdoc_posts"], ["rmdoc_posts", 1], post);

      // Verify indexed
      let results = await fts.search(["rmdoc_posts"], "Test");
      expect(results.length).toBe(1);

      // Remove
      await fts.removeDocument(["rmdoc_posts"], ["rmdoc_posts", 1]);

      // Verify removed from index
      results = await fts.search(["rmdoc_posts"], "Test");
      expect(results.length).toBe(0);
    });
  });

  // ==========================================================================
  // Search Queries
  // ==========================================================================

  describe("search", () => {
    it("should find documents by single term", async () => {
      await fts.createIndex(["search_posts"], {
        fields: ["title", "content", "tags"],
      });

      const posts = [
        { id: 1, title: "JavaScript Basics", content: "Introduction to JavaScript programming", tags: "beginner" },
        { id: 2, title: "Advanced TypeScript", content: "Deep dive into TypeScript features", tags: "advanced" },
        { id: 3, title: "React Tutorial", content: "Building apps with React and JavaScript", tags: "frontend" },
      ];

      for (const post of posts) {
        await kv.set(["search_posts", post.id], post);
        await fts.indexDocument(["search_posts"], ["search_posts", post.id], post);
      }

      const results = await fts.search(["search_posts"], "JavaScript");
      expect(results.length).toBe(2); // Basics, React
    });

    it("should support AND operator", async () => {
      await fts.createIndex(["and_posts"], {
        fields: ["title", "content"],
      });

      await kv.set(["and_posts", 1], { title: "JavaScript Guide", content: "Learn JavaScript" });
      await fts.indexDocument(["and_posts"], ["and_posts", 1], { title: "JavaScript Guide", content: "Learn JavaScript" });

      await kv.set(["and_posts", 2], { title: "Node Guide", content: "Server JavaScript with Node" });
      await fts.indexDocument(["and_posts"], ["and_posts", 2], { title: "Node Guide", content: "Server JavaScript with Node" });

      const results = await fts.search(["and_posts"], "JavaScript AND Node");
      expect(results.length).toBe(1);
      expect((results[0]?.value as any).title).toBe("Node Guide");
    });

    it("should support OR operator", async () => {
      await fts.createIndex(["or_posts"], {
        fields: ["title"],
      });

      await kv.set(["or_posts", 1], { title: "Python Tutorial" });
      await fts.indexDocument(["or_posts"], ["or_posts", 1], { title: "Python Tutorial" });

      await kv.set(["or_posts", 2], { title: "TypeScript Guide" });
      await fts.indexDocument(["or_posts"], ["or_posts", 2], { title: "TypeScript Guide" });

      await kv.set(["or_posts", 3], { title: "Java Basics" });
      await fts.indexDocument(["or_posts"], ["or_posts", 3], { title: "Java Basics" });

      const results = await fts.search(["or_posts"], "Python OR TypeScript");
      expect(results.length).toBe(2);
    });

    it("should search across multiple fields", async () => {
      await fts.createIndex(["multi_posts"], {
        fields: ["title", "tags"],
      });

      await kv.set(["multi_posts", 1], { title: "JavaScript Basics", tags: "beginner" });
      await fts.indexDocument(["multi_posts"], ["multi_posts", 1], { title: "JavaScript Basics", tags: "beginner" });

      // "beginner" is only in tags field
      const results = await fts.search(["multi_posts"], "beginner");
      expect(results.length).toBe(1);
      expect((results[0]?.value as any).title).toBe("JavaScript Basics");
    });

    it("should respect limit option", async () => {
      await fts.createIndex(["limit_posts"], {
        fields: ["title"],
      });

      for (let i = 1; i <= 5; i++) {
        await kv.set(["limit_posts", i], { title: `JavaScript Post ${i}` });
        await fts.indexDocument(["limit_posts"], ["limit_posts", i], { title: `JavaScript Post ${i}` });
      }

      const results = await fts.search(["limit_posts"], "JavaScript", { limit: 2 });
      expect(results.length).toBe(2);
    });

    it("should return empty array for no matches", async () => {
      await fts.createIndex(["empty_posts"], {
        fields: ["title"],
      });

      await kv.set(["empty_posts", 1], { title: "Hello World" });
      await fts.indexDocument(["empty_posts"], ["empty_posts", 1], { title: "Hello World" });

      const results = await fts.search(["empty_posts"], "nonexistentterm12345");
      expect(results).toEqual([]);
    });

    it("should throw error for prefix without index", async () => {
      await expect(fts.search(["noindex"], "test")).rejects.toThrow("No index found for prefix");
    });
  });

  // ==========================================================================
  // Tokenizer Tests
  // ==========================================================================

  describe("tokenizers", () => {
    it("should handle unicode with unicode61 tokenizer", async () => {
      await fts.createIndex(["intl"], {
        fields: ["text"],
        tokenize: "unicode61",
      });

      await kv.set(["intl", 1], { text: "Bonjour le monde" });
      await fts.indexDocument(["intl"], ["intl", 1], { text: "Bonjour le monde" });

      await kv.set(["intl", 2], { text: "Hola mundo" });
      await fts.indexDocument(["intl"], ["intl", 2], { text: "Hola mundo" });

      const french = await fts.search(["intl"], "Bonjour");
      expect(french.length).toBe(1);

      const spanish = await fts.search(["intl"], "mundo");
      expect(spanish.length).toBe(1);
    });

    it("should stem words with porter tokenizer", async () => {
      await fts.createIndex(["english"], {
        fields: ["text"],
        tokenize: "porter",
      });

      await kv.set(["english", 1], { text: "running runners run" });
      await fts.indexDocument(["english"], ["english", 1], { text: "running runners run" });

      // Porter stemmer should find "run" base form
      const results = await fts.search(["english"], "run");
      expect(results.length).toBe(1);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("edge cases", () => {
    it("should handle document update", async () => {
      await fts.createIndex(["update_posts"], {
        fields: ["title"],
      });

      // Initial document
      await kv.set(["update_posts", 1], { title: "Original Title" });
      await fts.indexDocument(["update_posts"], ["update_posts", 1], { title: "Original Title" });

      let results = await fts.search(["update_posts"], "Original");
      expect(results.length).toBe(1);

      // Update document
      await kv.set(["update_posts", 1], { title: "Updated Title" });
      await fts.indexDocument(["update_posts"], ["update_posts", 1], { title: "Updated Title" });

      // Old term should not match
      results = await fts.search(["update_posts"], "Original");
      expect(results.length).toBe(0);

      // New term should match
      results = await fts.search(["update_posts"], "Updated");
      expect(results.length).toBe(1);
    });
  });
});
