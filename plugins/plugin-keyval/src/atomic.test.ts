import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Kv } from "./kv";
import { initSchema } from "./schema";
import { createTestAdapter } from "./test-helpers";

describe("AtomicOperation", () => {
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
    await adapter.execute("DELETE FROM kv_entries", []);
  });

  describe("basic operations", () => {
    it("should commit empty atomic operation", async () => {
      const result = await kv.atomic().commit();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.versionstamp).toBeDefined();
      }
    });

    it("should set a single value", async () => {
      const result = await kv.atomic().set(["key"], "value").commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get(["key"]);
      expect(entry.value).toBe("value");
    });

    it("should set multiple values atomically", async () => {
      const result = await kv
        .atomic()
        .set(["users", 1], { name: "Alice" })
        .set(["users", 2], { name: "Bob" })
        .commit();

      expect(result.ok).toBe(true);

      const user1 = await kv.get(["users", 1]);
      const user2 = await kv.get(["users", 2]);
      expect(user1.value).toEqual({ name: "Alice" });
      expect(user2.value).toEqual({ name: "Bob" });
    });

    it("should delete a value", async () => {
      await kv.set(["to-delete"], "value");

      const result = await kv.atomic().delete(["to-delete"]).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get(["to-delete"]);
      expect(entry.value).toBe(null);
    });
  });

  describe("check operations", () => {
    it("should commit when check passes", async () => {
      await kv.set(["counter"], 0);
      const entry = await kv.get(["counter"]);

      const result = await kv
        .atomic()
        .check({ key: ["counter"], versionstamp: entry.versionstamp })
        .set(["counter"], 1)
        .commit();

      expect(result.ok).toBe(true);
      const updated = await kv.get(["counter"]);
      expect(updated.value).toBe(1);
    });

    it("should fail when versionstamp mismatch", async () => {
      await kv.set(["counter"], 0);

      const result = await kv
        .atomic()
        .check({ key: ["counter"], versionstamp: "wrong-versionstamp" })
        .set(["counter"], 1)
        .commit();

      expect(result.ok).toBe(false);
      const entry = await kv.get(["counter"]);
      expect(entry.value).toBe(0); // unchanged
    });

    it("should pass when checking null for non-existent key", async () => {
      const result = await kv
        .atomic()
        .check({ key: ["new-key"], versionstamp: null })
        .set(["new-key"], "value")
        .commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get(["new-key"]);
      expect(entry.value).toBe("value");
    });

    it("should fail when checking null for existing key", async () => {
      await kv.set(["existing"], "value");

      const result = await kv
        .atomic()
        .check({ key: ["existing"], versionstamp: null })
        .set(["existing"], "new-value")
        .commit();

      expect(result.ok).toBe(false);
      const entry = await kv.get(["existing"]);
      expect(entry.value).toBe("value"); // unchanged
    });

    it("should support multiple checks", async () => {
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);

      const entryA = await kv.get(["a"]);
      const entryB = await kv.get(["b"]);

      const result = await kv
        .atomic()
        .check({ key: ["a"], versionstamp: entryA.versionstamp })
        .check({ key: ["b"], versionstamp: entryB.versionstamp })
        .set(["a"], 10)
        .set(["b"], 20)
        .commit();

      expect(result.ok).toBe(true);
      expect((await kv.get(["a"])).value).toBe(10);
      expect((await kv.get(["b"])).value).toBe(20);
    });
  });

  describe("sum operation", () => {
    it("should increment non-existent key from 0", async () => {
      const result = await kv.atomic().sum(["counter"], 1n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["counter"]);
      expect(entry.value).toBe(1);
    });

    it("should add to existing value", async () => {
      // Note: sum operation works with numbers (bigint is converted for SQL compatibility)
      await kv.set(["counter"], 10);

      const result = await kv.atomic().sum(["counter"], 5n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["counter"]);
      expect(entry.value).toBe(15);
    });

    it("should subtract with negative value", async () => {
      await kv.set(["balance"], 100);

      const result = await kv.atomic().sum(["balance"], -30n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["balance"]);
      expect(entry.value).toBe(70);
    });

    it("should handle multiple sums", async () => {
      await kv.set(["views"], 0);

      const result = await kv.atomic().sum(["views"], 1n).sum(["unique_visitors"], 1n).commit();

      expect(result.ok).toBe(true);
      expect((await kv.get(["views"])).value).toBe(1);
      expect((await kv.get(["unique_visitors"])).value).toBe(1);
    });
  });

  describe("max operation", () => {
    it("should set value when key doesn't exist", async () => {
      const result = await kv.atomic().max(["highscore"], 100n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["highscore"]);
      expect(entry.value).toBe(100);
    });

    it("should update when new value is higher", async () => {
      await kv.set(["highscore"], 50);

      const result = await kv.atomic().max(["highscore"], 100n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["highscore"]);
      expect(entry.value).toBe(100);
    });

    it("should not update when new value is lower", async () => {
      await kv.set(["highscore"], 100);

      const result = await kv.atomic().max(["highscore"], 50n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["highscore"]);
      expect(entry.value).toBe(100);
    });
  });

  describe("min operation", () => {
    it("should set value when key doesn't exist", async () => {
      const result = await kv.atomic().min(["lowest"], 100n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["lowest"]);
      expect(entry.value).toBe(100);
    });

    it("should update when new value is lower", async () => {
      await kv.set(["lowest"], 100);

      const result = await kv.atomic().min(["lowest"], 50n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["lowest"]);
      expect(entry.value).toBe(50);
    });

    it("should not update when new value is higher", async () => {
      await kv.set(["lowest"], 50);

      const result = await kv.atomic().min(["lowest"], 100n).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<number>(["lowest"]);
      expect(entry.value).toBe(50);
    });
  });

  describe("append operation", () => {
    it("should create array when key doesn't exist", async () => {
      const result = await kv.atomic().append(["logs"], ["event1", "event2"]).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<string[]>(["logs"]);
      expect(entry.value).toEqual(["event1", "event2"]);
    });

    it("should append to existing array", async () => {
      await kv.set(["logs"], ["event1"]);

      const result = await kv.atomic().append(["logs"], ["event2", "event3"]).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<string[]>(["logs"]);
      expect(entry.value).toEqual(["event1", "event2", "event3"]);
    });
  });

  describe("prepend operation", () => {
    it("should create array when key doesn't exist", async () => {
      const result = await kv.atomic().prepend(["recent"], ["item1", "item2"]).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<string[]>(["recent"]);
      expect(entry.value).toEqual(["item1", "item2"]);
    });

    it("should prepend to existing array", async () => {
      await kv.set(["recent"], ["item3"]);

      const result = await kv.atomic().prepend(["recent"], ["item1", "item2"]).commit();

      expect(result.ok).toBe(true);
      const entry = await kv.get<string[]>(["recent"]);
      expect(entry.value).toEqual(["item1", "item2", "item3"]);
    });
  });

  describe("uuidv7", () => {
    it("should resolve uuidv7 placeholder in key", async () => {
      const id = kv.uuidv7();
      const postId = "post-123";

      const result = await kv
        .atomic()
        .set(["posts", postId], { title: "Hello" })
        .set(["posts_by_time", id, postId], postId)
        .commit();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Find the index entry
      const entries = [];
      for await (const entry of kv.list(["posts_by_time"])) {
        entries.push(entry);
      }

      expect(entries.length).toBe(1);
      const indexKey = entries[0]?.key;
      expect(indexKey?.[0]).toBe("posts_by_time");
      expect(indexKey?.[1]).toBe(result.versionstamp);
      expect(indexKey?.[2]).toBe(postId);
    });

    it("should use same uuidv7 for all placeholders in same commit", async () => {
      const id1 = kv.uuidv7();
      const id2 = kv.uuidv7();

      const result = await kv
        .atomic()
        .set(["index1", id1], "value1")
        .set(["index2", id2], "value2")
        .commit();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const entries1 = [];
      for await (const entry of kv.list(["index1"])) {
        entries1.push(entry);
      }

      const entries2 = [];
      for await (const entry of kv.list(["index2"])) {
        entries2.push(entry);
      }

      expect(entries1[0]?.key?.[1]).toBe(result.versionstamp);
      expect(entries2[0]?.key?.[1]).toBe(result.versionstamp);
    });
  });

  describe("combined operations", () => {
    it("should handle set and sum together", async () => {
      const result = await kv
        .atomic()
        .set(["user", 1], { name: "Alice" })
        .sum(["stats", "users"], 1n)
        .commit();

      expect(result.ok).toBe(true);
      expect((await kv.get(["user", 1])).value).toEqual({ name: "Alice" });
      expect((await kv.get(["stats", "users"])).value).toBe(1);
    });

    it("should handle delete and set together", async () => {
      await kv.set(["old"], "value");

      const result = await kv.atomic().delete(["old"]).set(["new"], "value").commit();

      expect(result.ok).toBe(true);
      expect((await kv.get(["old"])).value).toBe(null);
      expect((await kv.get(["new"])).value).toBe("value");
    });
  });
});
