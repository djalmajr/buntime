import { beforeEach, describe, expect, it, mock } from "bun:test";
import { DurableObjectStorage, initDatabase } from "./storage";

/**
 * Creates a mock database adapter for unit tests
 */
const createMockAdapter = () => {
  const storage = new Map<string, { key: string; value: unknown }[]>();

  return {
    batch: mock((queries: { args?: unknown[]; sql: string }[]) => {
      // Process batch queries (used for schema creation and puts)
      for (const query of queries) {
        if (query.sql.includes("CREATE TABLE") || query.sql.includes("CREATE INDEX")) {
          // Schema creation - just acknowledge
          continue;
        }
        if (query.sql.includes("INSERT OR REPLACE")) {
          // Insert/update storage entry
          const args = query.args as [string, string, Uint8Array];
          const objectId = args[0];
          const key = args[1];
          const value = args[2];
          if (!storage.has(objectId)) {
            storage.set(objectId, []);
          }
          const entries = storage.get(objectId)!;
          const existingIdx = entries.findIndex((e) => e.key === key);
          if (existingIdx >= 0) {
            entries[existingIdx] = { key, value };
          } else {
            entries.push({ key, value });
          }
        }
      }
      return Promise.resolve([]);
    }),
    close: mock(() => Promise.resolve()),
    execute: mock((sql: string, args?: unknown[]) => {
      if (sql.includes("SELECT key, value FROM object_storage")) {
        // Handle get multiple or list
        const objectId = args?.[0] as string;
        const entries = storage.get(objectId) ?? [];

        if (sql.includes("IN (")) {
          // Get multiple keys
          const keys = args?.slice(1) as string[];
          return Promise.resolve(entries.filter((e) => keys.includes(e.key)));
        }

        // List with prefix/range
        let filtered = [...entries];
        if (sql.includes("LIKE")) {
          const prefix = (args?.[1] as string).replace("%", "");
          filtered = filtered.filter((e) => e.key.startsWith(prefix));
        }
        if (sql.includes("key >=")) {
          // Simplified - just return all for tests (range queries not fully mocked)
        }
        if (sql.includes("ORDER BY key DESC")) {
          filtered.reverse();
        }
        if (sql.includes("LIMIT")) {
          const limitIdx = args?.length ? args.length - 1 : 0;
          const limit = args?.[limitIdx] as number;
          if (limit) {
            filtered = filtered.slice(0, limit);
          }
        }
        return Promise.resolve(filtered);
      }
      if (sql.includes("SELECT key FROM object_storage")) {
        // Delete check
        const objectId = args?.[0] as string;
        const keys = args?.slice(1) as string[];
        const entries = storage.get(objectId) ?? [];
        return Promise.resolve(
          entries.filter((e) => keys.includes(e.key)).map((e) => ({ key: e.key })),
        );
      }
      if (sql.includes("DELETE FROM object_storage")) {
        // Delete entries
        const objectId = args?.[0] as string;
        const keys = args?.slice(1) as string[];
        const entries = storage.get(objectId) ?? [];
        const newEntries = entries.filter((e) => !keys.includes(e.key));
        storage.set(objectId, newEntries);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
    executeOne: mock((sql: string, args?: unknown[]) => {
      if (sql.includes("SELECT value FROM object_storage")) {
        const objectId = args?.[0] as string;
        const key = args?.[1] as string;
        const entries = storage.get(objectId) ?? [];
        const entry = entries.find((e) => e.key === key);
        return Promise.resolve(entry ? { value: entry.value } : null);
      }
      return Promise.resolve(null);
    }),
    type: "libsql",
  };
};

describe("initDatabase", () => {
  it("should create required tables and indexes", async () => {
    const mockAdapter = createMockAdapter();

    await initDatabase(mockAdapter as never);

    expect(mockAdapter.batch).toHaveBeenCalledTimes(1);
    const batchCalls = mockAdapter.batch.mock.calls[0]?.[0] as { sql: string }[];
    expect(batchCalls).toHaveLength(3);

    const durableObjectsTable = batchCalls[0];
    const objectStorageTable = batchCalls[1];
    const storageIndex = batchCalls[2];

    expect(durableObjectsTable).toBeDefined();
    expect(objectStorageTable).toBeDefined();
    expect(storageIndex).toBeDefined();

    // Check durable_objects table
    expect(durableObjectsTable!.sql).toContain("CREATE TABLE IF NOT EXISTS durable_objects");
    expect(durableObjectsTable!.sql).toContain("id TEXT PRIMARY KEY");
    expect(durableObjectsTable!.sql).toContain("class_name TEXT NOT NULL");

    // Check object_storage table
    expect(objectStorageTable!.sql).toContain("CREATE TABLE IF NOT EXISTS object_storage");
    expect(objectStorageTable!.sql).toContain("object_id TEXT NOT NULL");
    expect(objectStorageTable!.sql).toContain("key TEXT NOT NULL");
    expect(objectStorageTable!.sql).toContain("value BLOB");
    expect(objectStorageTable!.sql).toContain(
      "FOREIGN KEY (object_id) REFERENCES durable_objects(id)",
    );

    // Check index
    expect(storageIndex!.sql).toContain("CREATE INDEX IF NOT EXISTS idx_storage_prefix");
  });
});

describe("DurableObjectStorage", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let storage: DurableObjectStorage;
  const objectId = "test-object-123";

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    storage = new DurableObjectStorage(mockAdapter as never, objectId);
  });

  describe("get", () => {
    it("should return undefined for non-existent key", async () => {
      const result = await storage.get("non-existent");

      expect(result).toBeUndefined();
    });

    it("should return value for existing key", async () => {
      await storage.put("key1", { name: "test" });
      const result = await storage.get("key1");

      expect(result).toEqual({ name: "test" });
    });

    it("should get multiple keys at once", async () => {
      await storage.put({ key1: "value1", key2: "value2", key3: "value3" });

      const result = await storage.get(["key1", "key2"]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get("key1")).toBe("value1");
      expect(result.get("key2")).toBe("value2");
    });

    it("should return empty map for empty keys array", async () => {
      const result = await storage.get([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });

  describe("put", () => {
    it("should store single key-value pair", async () => {
      await storage.put("key1", { data: "test" });

      const result = await storage.get("key1");
      expect(result).toEqual({ data: "test" });
    });

    it("should store multiple key-value pairs", async () => {
      await storage.put({
        key1: "value1",
        key2: "value2",
        key3: { nested: true },
      });

      expect(await storage.get<string>("key1")).toBe("value1");
      expect(await storage.get<string>("key2")).toBe("value2");
      expect(await storage.get<{ nested: boolean }>("key3")).toEqual({ nested: true });
    });

    it("should overwrite existing value", async () => {
      await storage.put("key1", "original");
      await storage.put("key1", "updated");

      const result = await storage.get("key1");
      expect(result).toBe("updated");
    });

    it("should serialize complex objects", async () => {
      const complexValue = {
        array: [1, 2, 3],
        date: "2024-01-01",
        nested: { deep: { value: true } },
        number: 42,
        string: "hello",
      };

      await storage.put("complex", complexValue);

      const result = await storage.get("complex");
      expect(result).toEqual(complexValue);
    });
  });

  describe("delete", () => {
    it("should return false for non-existent key", async () => {
      const result = await storage.delete("non-existent");

      expect(result).toBe(false);
    });

    it("should return true when key exists", async () => {
      await storage.put("key1", "value1");
      const result = await storage.delete("key1");

      expect(result).toBe(true);
    });

    it("should delete multiple keys", async () => {
      await storage.put({ key1: "v1", key2: "v2", key3: "v3" });

      const count = await storage.delete(["key1", "key2"]);

      expect(count).toBe(2);
      expect(await storage.get<string>("key1")).toBeUndefined();
      expect(await storage.get<string>("key2")).toBeUndefined();
      expect(await storage.get<string>("key3")).toBe("v3");
    });

    it("should return 0 for empty keys array", async () => {
      const result = await storage.delete([]);

      expect(result).toBe(0);
    });

    it("should return count of actually deleted keys", async () => {
      await storage.put({ key1: "v1", key2: "v2" });

      const count = await storage.delete(["key1", "key2", "non-existent"]);

      expect(count).toBe(2);
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      // Setup test data
      await storage.put({
        "prefix:a": 1,
        "prefix:b": 2,
        "prefix:c": 3,
        "other:x": 4,
        "other:y": 5,
      });
    });

    it("should list all entries without options", async () => {
      const result = await storage.list();

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBeGreaterThan(0);
    });

    it("should filter by prefix", async () => {
      const result = await storage.list({ prefix: "prefix:" });

      expect(result.size).toBe(3);
      expect(result.has("prefix:a")).toBe(true);
      expect(result.has("prefix:b")).toBe(true);
      expect(result.has("prefix:c")).toBe(true);
      expect(result.has("other:x")).toBe(false);
    });

    it("should respect limit option", async () => {
      const result = await storage.list({ limit: 2 });

      expect(result.size).toBe(2);
    });

    it("should default limit to 1000", async () => {
      const listSpy = mockAdapter.execute;

      await storage.list();

      const lastCall = listSpy.mock.calls[listSpy.mock.calls.length - 1];
      const args = lastCall?.[1] as unknown[];
      expect(args[args.length - 1]).toBe(1000);
    });
  });

  describe("transaction", () => {
    it("should execute transaction closure", async () => {
      const result = await storage.transaction(async (txn) => {
        txn.put("txKey", "txValue");
        return "success";
      });

      expect(result).toBe("success");
    });

    it("should apply puts after commit", async () => {
      await storage.transaction(async (txn) => {
        txn.put("key1", "value1");
        txn.put("key2", "value2");
      });

      expect(await storage.get<string>("key1")).toBe("value1");
      expect(await storage.get<string>("key2")).toBe("value2");
    });

    it("should apply deletes after commit", async () => {
      await storage.put({ key1: "v1", key2: "v2" });

      await storage.transaction(async (txn) => {
        txn.delete("key1");
      });

      expect(await storage.get<string>("key1")).toBeUndefined();
      expect(await storage.get<string>("key2")).toBe("v2");
    });

    it("should read cached values within transaction", async () => {
      await storage.put("existing", "original");

      const result = await storage.transaction(async (txn) => {
        txn.put("existing", "modified");
        return await txn.get("existing");
      });

      expect(result).toBe("modified");
    });

    it("should handle rollback", async () => {
      await storage.put("key1", "original");

      try {
        await storage.transaction(async (txn) => {
          txn.put("key1", "modified");
          txn.rollback();
          // After rollback, operations should throw
          expect(() => txn.put("key2", "value")).toThrow("Transaction rolled back");
        });
      } catch {
        // Expected
      }

      // Original value should be preserved
      expect(await storage.get<string>("key1")).toBe("original");
    });

    it("should support batch puts in transaction", async () => {
      await storage.transaction(async (txn) => {
        txn.put({ a: 1, b: 2, c: 3 });
      });

      expect(await storage.get<number>("a")).toBe(1);
      expect(await storage.get<number>("b")).toBe(2);
      expect(await storage.get<number>("c")).toBe(3);
    });

    it("should support batch deletes in transaction", async () => {
      await storage.put({ a: 1, b: 2, c: 3, d: 4 });

      await storage.transaction(async (txn) => {
        txn.delete(["a", "b", "c"]);
      });

      expect(await storage.get<number>("a")).toBeUndefined();
      expect(await storage.get<number>("b")).toBeUndefined();
      expect(await storage.get<number>("c")).toBeUndefined();
      expect(await storage.get<number>("d")).toBe(4);
    });

    it("should get multiple keys within transaction", async () => {
      await storage.put({ key1: "v1", key2: "v2", key3: "v3" });

      const result = await storage.transaction(async (txn) => {
        return await txn.get(["key1", "key2"]);
      });

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get("key1")).toBe("v1");
      expect(result.get("key2")).toBe("v2");
    });

    it("should not return deleted keys in transaction get", async () => {
      await storage.put({ key1: "v1", key2: "v2" });

      const result = await storage.transaction(async (txn) => {
        txn.delete("key1");
        return await txn.get("key1");
      });

      expect(result).toBeUndefined();
    });
  });
});

describe("InMemoryTransaction edge cases", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let storage: DurableObjectStorage;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    storage = new DurableObjectStorage(mockAdapter as never, "test-object");
  });

  it("should handle put then delete same key", async () => {
    await storage.transaction(async (txn) => {
      txn.put("key", "value");
      txn.delete("key");
    });

    expect(await storage.get<string>("key")).toBeUndefined();
  });

  it("should handle delete then put same key", async () => {
    await storage.put("key", "original");

    await storage.transaction(async (txn) => {
      txn.delete("key");
      txn.put("key", "new");
    });

    expect(await storage.get<string>("key")).toBe("new");
  });

  it("should not commit after rollback", async () => {
    await storage.put("key", "original");

    await storage.transaction(async (txn) => {
      txn.put("key", "modified");
      txn.rollback();
    });

    expect(await storage.get<string>("key")).toBe("original");
  });
});
