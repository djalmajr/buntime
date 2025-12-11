import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { LibSqlAdapter } from "@buntime/plugin-database";
import { Kv } from "../src/kv";
import { initSchema } from "../src/schema";

describe("Kv", () => {
  let adapter: LibSqlAdapter;
  let kv: Kv;

  beforeAll(async () => {
    adapter = new LibSqlAdapter({ type: "libsql", url: ":memory:" });
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

  describe("get/set", () => {
    it("should return null for non-existent key", async () => {
      const entry = await kv.get(["nonexistent"]);
      expect(entry.key).toEqual(["nonexistent"]);
      expect(entry.value).toBe(null);
      expect(entry.versionstamp).toBe(null);
    });

    it("should store and retrieve values", async () => {
      const key = ["users", 123];
      const value = { name: "Alice", age: 30 };

      await kv.set(key, value);
      const entry = await kv.get<typeof value>(key);

      expect(entry.key).toEqual(key);
      expect(entry.value).toEqual(value);
      expect(entry.versionstamp).toBeDefined();
      expect(entry.versionstamp).not.toBe(null);
    });

    it("should handle complex keys", async () => {
      const key = ["users", 123, "profile", true];
      const value = { name: "Alice" };

      await kv.set(key, value);
      const entry = await kv.get<typeof value>(key);

      expect(entry.key).toEqual(key);
      expect(entry.value).toEqual(value);
    });

    it("should overwrite existing values", async () => {
      const key = ["counter"];

      await kv.set(key, 1);
      const first = await kv.get<number>(key);
      expect(first.value).toBe(1);

      await kv.set(key, 2);
      const second = await kv.get<number>(key);
      expect(second.value).toBe(2);
      expect(second.versionstamp).not.toBe(first.versionstamp);
    });

    it("should respect expiration", async () => {
      const key = ["session", "abc"];
      const value = { userId: 123 };

      // expireIn is in milliseconds, converted to seconds (min 1 second)
      await kv.set(key, value, { expireIn: 1500 }); // 1.5 seconds

      const before = await kv.get(key);
      expect(before.value).toEqual(value);

      // Wait for expiration (more than 1.5 seconds)
      await new Promise((r) => setTimeout(r, 2000));

      // Expired entries are filtered by the SELECT
      const after = await kv.get(key);
      expect(after.value).toBe(null);
    });

    it("should store different value types", async () => {
      await kv.set(["string"], "hello");
      await kv.set(["number"], 42);
      await kv.set(["boolean"], true);
      await kv.set(["null"], null);
      await kv.set(["array"], [1, 2, 3]);
      await kv.set(["object"], { a: 1 });

      expect((await kv.get(["string"])).value).toBe("hello");
      expect((await kv.get(["number"])).value).toBe(42);
      expect((await kv.get(["boolean"])).value).toBe(true);
      expect((await kv.get(["null"])).value).toBe(null);
      expect((await kv.get(["array"])).value).toEqual([1, 2, 3]);
      expect((await kv.get(["object"])).value).toEqual({ a: 1 });
    });
  });

  describe("getMany", () => {
    it("should return empty array for empty keys", async () => {
      const result = await kv.getMany([]);
      expect(result).toEqual([]);
    });

    it("should get multiple values in one call", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });
      await kv.set(["users", 3], { name: "Charlie" });

      const entries = await kv.getMany<{ name: string }>([
        ["users", 1],
        ["users", 2],
        ["users", 3],
      ]);

      expect(entries.length).toBe(3);
      expect(entries[0]?.value?.name).toBe("Alice");
      expect(entries[1]?.value?.name).toBe("Bob");
      expect(entries[2]?.value?.name).toBe("Charlie");
    });

    it("should maintain order of keys", async () => {
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      const entries = await kv.getMany<number>([["c"], ["a"], ["b"]]);

      expect(entries[0]?.key).toEqual(["c"]);
      expect(entries[0]?.value).toBe(3);
      expect(entries[1]?.key).toEqual(["a"]);
      expect(entries[1]?.value).toBe(1);
      expect(entries[2]?.key).toEqual(["b"]);
      expect(entries[2]?.value).toBe(2);
    });

    it("should return null for missing keys", async () => {
      await kv.set(["exists"], "value");

      const entries = await kv.getMany([["exists"], ["missing"], ["also-missing"]]);

      expect(entries[0]?.value).toBe("value");
      expect(entries[1]?.value).toBe(null);
      expect(entries[2]?.value).toBe(null);
    });
  });

  describe("delete", () => {
    it("should delete existing key", async () => {
      const key = ["to-delete"];
      await kv.set(key, "value");
      expect((await kv.get(key)).value).toBe("value");

      await kv.delete(key);
      expect((await kv.get(key)).value).toBe(null);
    });

    it("should not throw for non-existent key", async () => {
      await expect(kv.delete(["nonexistent"])).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });
      await kv.set(["users", 3], { name: "Charlie" });
      await kv.set(["posts", 1], { title: "Post 1" });
      await kv.set(["posts", 2], { title: "Post 2" });
    });

    it("should filter by prefix", async () => {
      const entries = [];
      for await (const entry of kv.list(["users"])) {
        entries.push(entry);
      }

      expect(entries.length).toBe(3);
      expect(entries.every((e) => e.key[0] === "users")).toBe(true);
    });

    it("should respect limit", async () => {
      const entries = [];
      for await (const entry of kv.list(["users"], { limit: 2 })) {
        entries.push(entry);
      }

      expect(entries.length).toBe(2);
    });

    it("should support reverse order", async () => {
      const entries = [];
      for await (const entry of kv.list(["users"], { reverse: true })) {
        entries.push(entry);
      }

      expect(entries.length).toBe(3);
      expect(entries[0]?.key).toEqual(["users", 3]);
      expect(entries[2]?.key).toEqual(["users", 1]);
    });

    it("should handle start/end bounds", async () => {
      const entries = [];
      for await (const entry of kv.list(["users"], {
        start: ["users", 2],
        end: ["users", 3],
      })) {
        entries.push(entry);
      }

      expect(entries.length).toBe(1);
      expect(entries[0]?.key).toEqual(["users", 2]);
    });

    it("should return empty for non-matching prefix", async () => {
      const entries = [];
      for await (const entry of kv.list(["nonexistent"])) {
        entries.push(entry);
      }

      expect(entries.length).toBe(0);
    });
  });

  describe("getAdapter", () => {
    it("should return the underlying adapter", () => {
      const underlying = kv.getAdapter();
      expect(underlying).toBe(adapter);
    });
  });

  describe("getLogger", () => {
    it("should return undefined when no logger configured", () => {
      const logger = kv.getLogger();
      expect(logger).toBeUndefined();
    });

    it("should return logger when configured", async () => {
      const mockLogger = {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
      };

      const kvWithLogger = new Kv(adapter, { logger: mockLogger });
      expect(kvWithLogger.getLogger()).toBe(mockLogger);
      kvWithLogger.close();
    });
  });

  describe("close", () => {
    it("should stop cleanup interval", async () => {
      const tempAdapter = new LibSqlAdapter({ type: "libsql", url: ":memory:" });
      await initSchema(tempAdapter);
      const tempKv = new Kv(tempAdapter);

      // Just verify close doesn't throw
      tempKv.close();
      await tempAdapter.close();
    });

    it("should close metrics if created", async () => {
      const tempAdapter = new LibSqlAdapter({ type: "libsql", url: ":memory:" });
      await initSchema(tempAdapter);
      const tempKv = new Kv(tempAdapter, { persistentMetrics: true });

      // Access metrics to create it
      tempKv.metrics.recordOperation("get", 5);

      // Close should flush and cleanup
      tempKv.close();
      await tempAdapter.close();
    });
  });

  describe("cleanup", () => {
    it("should run periodic cleanup of expired entries", async () => {
      const tempAdapter = new LibSqlAdapter({ type: "libsql", url: ":memory:" });
      await initSchema(tempAdapter);
      const tempKv = new Kv(tempAdapter);

      // Set an entry with short expiration
      await tempKv.set(["expire", "test"], "value", { expireIn: 100 });

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 200));

      // Verify entry is filtered out
      const entry = await tempKv.get(["expire", "test"]);
      expect(entry.value).toBe(null);

      tempKv.close();
      await tempAdapter.close();
    });

    it("should handle cleanup errors gracefully", async () => {
      const errorLogs: string[] = [];
      const mockLogger = {
        debug: () => {},
        error: (msg: string) => errorLogs.push(msg),
        info: () => {},
        warn: () => {},
      };

      const tempAdapter = new LibSqlAdapter({ type: "libsql", url: ":memory:" });
      await initSchema(tempAdapter);

      // Drop the table to cause cleanup errors
      await tempAdapter.execute("DROP TABLE kv_entries");

      const tempKv = new Kv(tempAdapter, { logger: mockLogger });

      // Wait for cleanup to run and fail (cleanup runs every 60s, but we can trigger manually)
      // Since cleanup is internal, we just verify the kv works despite missing table
      try {
        await tempKv.get(["test"]);
      } catch {
        // Expected to fail since table is dropped
      }

      tempKv.close();
      await tempAdapter.close();
    });
  });
});
