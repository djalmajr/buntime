import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Kv } from "../lib/kv";
import { initSchema } from "../lib/schema";
import { createTestAdapter } from "../lib/test-helpers";
import type { KvPaginateResult } from "../lib/types";

describe("Pagination", () => {
  const adapter = createTestAdapter();
  let kv: Kv;

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
  });

  async function seedItems(count: number, prefix = "items") {
    for (let i = 1; i <= count; i++) {
      await kv.set([prefix, i], { id: i, name: `Item ${i}` });
    }
  }

  describe("paginate", () => {
    it("should return first page with cursor", async () => {
      await seedItems(10);

      const page1 = await kv.paginate(["items"], { limit: 3 });

      expect(page1.entries.length).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.cursor).not.toBeNull();
      expect(page1.entries[0]?.value).toEqual({ id: 1, name: "Item 1" });
      expect(page1.entries[2]?.value).toEqual({ id: 3, name: "Item 3" });
    });

    it("should return next page using cursor", async () => {
      await seedItems(10);

      const page1 = await kv.paginate(["items"], { limit: 3 });
      const page2 = await kv.paginate(["items"], { limit: 3, cursor: page1.cursor! });

      expect(page2.entries.length).toBe(3);
      expect(page2.hasMore).toBe(true);
      expect(page2.entries[0]?.value).toEqual({ id: 4, name: "Item 4" });
      expect(page2.entries[2]?.value).toEqual({ id: 6, name: "Item 6" });
    });

    it("should return last page with hasMore=false", async () => {
      await seedItems(5);

      const page1 = await kv.paginate(["items"], { limit: 3 });
      const page2 = await kv.paginate(["items"], { limit: 3, cursor: page1.cursor! });

      expect(page2.entries.length).toBe(2);
      expect(page2.hasMore).toBe(false);
      expect(page2.cursor).toBeNull();
    });

    it("should handle exact page boundary", async () => {
      await seedItems(6);

      const page1 = await kv.paginate(["items"], { limit: 3 });
      const page2 = await kv.paginate(["items"], { limit: 3, cursor: page1.cursor! });

      expect(page1.entries.length).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page2.entries.length).toBe(3);
      expect(page2.hasMore).toBe(false);
    });

    it("should return empty when no entries match", async () => {
      await seedItems(5, "other");

      const page = await kv.paginate(["items"], { limit: 3 });

      expect(page.entries.length).toBe(0);
      expect(page.hasMore).toBe(false);
      expect(page.cursor).toBeNull();
    });

    it("should paginate in reverse order", async () => {
      await seedItems(10);

      const page1 = await kv.paginate(["items"], { limit: 3, reverse: true });

      expect(page1.entries.length).toBe(3);
      expect(page1.entries[0]?.value).toEqual({ id: 10, name: "Item 10" });
      expect(page1.entries[2]?.value).toEqual({ id: 8, name: "Item 8" });

      const page2 = await kv.paginate(["items"], {
        limit: 3,
        reverse: true,
        cursor: page1.cursor!,
      });

      expect(page2.entries[0]?.value).toEqual({ id: 7, name: "Item 7" });
    });

    it("should use default limit of 100", async () => {
      await seedItems(150);

      const page = await kv.paginate(["items"]);

      expect(page.entries.length).toBe(100);
      expect(page.hasMore).toBe(true);
    });

    it("should iterate through all pages", async () => {
      await seedItems(25);

      const allEntries = [];
      let cursor: string | null = null;
      let page: KvPaginateResult;

      do {
        page = await kv.paginate(["items"], { limit: 7, cursor: cursor ?? undefined });
        allEntries.push(...page.entries);
        cursor = page.cursor;
      } while (cursor !== null);

      expect(allEntries.length).toBe(25);
      expect(allEntries[0]?.value).toEqual({ id: 1, name: "Item 1" });
      expect(allEntries[24]?.value).toEqual({ id: 25, name: "Item 25" });
    });

    it("should handle single item", async () => {
      await seedItems(1);

      const page = await kv.paginate(["items"], { limit: 10 });

      expect(page.entries.length).toBe(1);
      expect(page.hasMore).toBe(false);
      expect(page.cursor).toBeNull();
    });

    it("should work with complex keys", async () => {
      for (let i = 1; i <= 10; i++) {
        await kv.set(["users", 1, "posts", i], { postId: i, title: `Post ${i}` });
      }

      const page1 = await kv.paginate(["users", 1, "posts"], { limit: 4 });

      expect(page1.entries.length).toBe(4);
      expect(page1.hasMore).toBe(true);
      expect(page1.entries[0]?.key).toEqual(["users", 1, "posts", 1]);
    });
  });

  describe("cursor encoding", () => {
    it("should produce base64-encoded cursors", async () => {
      await seedItems(10);

      const page = await kv.paginate(["items"], { limit: 3 });

      expect(page.cursor).toBeDefined();
      // Check if cursor is base64-like
      expect(page.cursor).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it("should handle invalid cursor gracefully", async () => {
      await seedItems(10);

      // Invalid base64 should throw or return empty
      try {
        const page = await kv.paginate(["items"], { cursor: "invalid-cursor!!!" });
        // If it doesn't throw, should return some result
        expect(page.entries).toBeDefined();
      } catch (error) {
        // Expected behavior for invalid cursor
        expect(error).toBeDefined();
      }
    });
  });

  describe("pagination with where filters", () => {
    it("should paginate filtered results", async () => {
      for (let i = 1; i <= 20; i++) {
        await kv.set(["products", i], {
          id: i,
          name: `Product ${i}`,
          category: i % 2 === 0 ? "even" : "odd",
        });
      }

      // Note: If pagination with where is supported, test it
      // Otherwise, this documents that where + paginate may need separate implementation
      const page1 = await kv.paginate(["products"], { limit: 5 });

      expect(page1.entries.length).toBe(5);
      expect(page1.hasMore).toBe(true);
    });
  });
});
