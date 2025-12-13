import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Kv } from "./keyval";

// Store original fetch
const originalFetch = globalThis.fetch;

// Helper to create mock fetch
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  // biome-ignore lint/suspicious/noExplicitAny: Mock fetch requires any type
  globalThis.fetch = mock(async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as unknown as typeof fetch;
}

describe("Kv", () => {
  let kv: Kv;

  beforeEach(() => {
    kv = new Kv("http://localhost:8000/api/keyval");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("get", () => {
    it("should return entry for existing key", async () => {
      mockFetch((url) => {
        if (url.includes("/keys/users/123")) {
          return new Response(
            JSON.stringify({
              key: ["users", 123],
              value: { name: "Alice" },
              versionstamp: "0001",
            }),
          );
        }
        return new Response("", { status: 404 });
      });

      const entry = await kv.get<{ name: string }>(["users", 123]);

      expect(entry.key).toEqual(["users", 123]);
      expect(entry.value?.name).toBe("Alice");
      expect(entry.versionstamp).toBe("0001");
    });

    it("should return null for non-existent key", async () => {
      mockFetch(() => new Response("", { status: 404 }));

      const entry = await kv.get(["nonexistent"]);

      expect(entry.key).toEqual(["nonexistent"]);
      expect(entry.value).toBe(null);
      expect(entry.versionstamp).toBe(null);
    });

    it("should return empty array for empty keys array", async () => {
      const result = await kv.get([]);
      expect(result).toEqual([]);
    });

    it("should get multiple values with array of keys", async () => {
      mockFetch((url) => {
        if (url.includes("/keys/batch")) {
          return new Response(
            JSON.stringify([
              { key: ["users", 1], value: { name: "Alice" }, versionstamp: "0001" },
              { key: ["users", 2], value: { name: "Bob" }, versionstamp: "0002" },
            ]),
          );
        }
        return new Response("", { status: 404 });
      });

      const entries = await kv.get<{ name: string }>([
        ["users", 1],
        ["users", 2],
      ]);

      expect(entries.length).toBe(2);
      expect(entries[0]?.value?.name).toBe("Alice");
      expect(entries[1]?.value?.name).toBe("Bob");
    });
  });

  describe("get with multiple keys", () => {
    it("should return empty array for empty keys", async () => {
      const result = await kv.get([]);
      expect(result).toEqual([]);
    });

    it("should get multiple values in one request", async () => {
      mockFetch((url) => {
        if (url.includes("/keys/batch")) {
          return new Response(
            JSON.stringify([
              { key: ["users", 1], value: { name: "Alice" }, versionstamp: "0001" },
              { key: ["users", 2], value: { name: "Bob" }, versionstamp: "0002" },
            ]),
          );
        }
        return new Response("", { status: 404 });
      });

      const entries = await kv.get<{ name: string }>([
        ["users", 1],
        ["users", 2],
      ]);

      expect(entries.length).toBe(2);
      expect(entries[0]?.value?.name).toBe("Alice");
      expect(entries[1]?.value?.name).toBe("Bob");
    });
  });

  describe("set", () => {
    it("should set a value and return versionstamp", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ ok: true, versionstamp: "0001" }));
      });

      const result = await kv.set(["users", 123], { name: "Alice" });

      expect(result.ok).toBe(true);
      expect(result.versionstamp).toBe("0001");
      expect(JSON.parse(capturedBody)).toEqual({ name: "Alice" });
    });

    it("should pass expiresIn option as milliseconds", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ ok: true, versionstamp: "0001" }));
      });

      await kv.set(["session"], { token: "abc" }, { expiresIn: 60000 });

      expect(capturedUrl).toContain("expiresIn=60000");
    });

    it("should parse expiresIn string duration", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ ok: true, versionstamp: "0001" }));
      });

      await kv.set(["session"], { token: "abc" }, { expiresIn: "1h" });

      expect(capturedUrl).toContain("expiresIn=3600000");
    });
  });

  describe("delete", () => {
    it("should delete a key and children", async () => {
      let capturedMethod = "";
      mockFetch((_url, init) => {
        capturedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify({ success: true, deletedCount: 3 }));
      });

      const result = await kv.delete(["users", 123]);

      expect(capturedMethod).toBe("DELETE");
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
    });

    it("should delete with where filter", async () => {
      let capturedBody = "";
      let capturedContentType = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        capturedContentType = (init?.headers as Record<string, string>)?.["Content-Type"] ?? "";
        return new Response(JSON.stringify({ success: true, deletedCount: 5 }));
      });

      const result = await kv.delete(["sessions"], {
        where: { expiresAt: { $lt: 1234567890 } },
      });

      expect(capturedContentType).toBe("application/json");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.where).toEqual({ expiresAt: { $lt: 1234567890 } });
      expect(result.deletedCount).toBe(5);
    });

    it("should delete with complex filter using $or", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true, deletedCount: 10 }));
      });

      await kv.delete(["users"], {
        where: {
          $or: [{ status: { $eq: "inactive" } }, { "profile.verified": { $eq: false } }],
        },
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.where.$or).toHaveLength(2);
      expect(parsed.where.$or[0]).toEqual({ status: { $eq: "inactive" } });
      expect(parsed.where.$or[1]).toEqual({ "profile.verified": { $eq: false } });
    });

    it("should delete with $in operator", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true, deletedCount: 2 }));
      });

      await kv.delete(["logs"], {
        where: { level: { $in: ["debug", "trace"] } },
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.where.level.$in).toEqual(["debug", "trace"]);
    });

    it("should not send body when no filter provided", async () => {
      let capturedBody: string | undefined;
      mockFetch((_url, init) => {
        capturedBody = init?.body as string | undefined;
        return new Response(JSON.stringify({ success: true, deletedCount: 1 }));
      });

      await kv.delete(["users", 123]);

      expect(capturedBody).toBeUndefined();
    });

    it("should delete multiple keys using batch endpoint", async () => {
      let capturedUrl = "";
      let capturedBody = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ deletedCount: 2 }));
      });

      const result = await kv.delete([
        ["users", 123],
        ["users", 456],
      ]);

      expect(capturedUrl).toContain("/keys/delete-batch");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.keys).toEqual([
        ["users", 123],
        ["users", 456],
      ]);
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it("should delete multiple keys with options using batch endpoint", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ deletedCount: 3 }));
      });

      const result = await kv.delete(
        [
          ["sessions", 1],
          ["sessions", 2],
        ],
        { exact: true, where: { active: { $eq: false } } },
      );

      const parsed = JSON.parse(capturedBody);
      expect(parsed.keys).toHaveLength(2);
      expect(parsed.exact).toBe(true);
      expect(parsed.where).toEqual({ active: { $eq: false } });
      expect(result.deletedCount).toBe(3);
    });

    it("should delete with exact option set to true", async () => {
      let capturedBody = "";
      let capturedContentType = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        capturedContentType = (init?.headers as Record<string, string>)?.["Content-Type"] ?? "";
        return new Response(JSON.stringify({ success: true, deletedCount: 1 }));
      });

      const result = await kv.delete(["users", 123], { exact: true });

      expect(capturedContentType).toBe("application/json");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.exact).toBe(true);
      expect(result.deletedCount).toBe(1);
    });

    it("should delete with exact option set to false", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true, deletedCount: 5 }));
      });

      const result = await kv.delete(["users", 123], { exact: false });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.exact).toBe(false);
      expect(result.deletedCount).toBe(5);
    });

    it("should delete with both exact and where options", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ success: true, deletedCount: 2 }));
      });

      const result = await kv.delete(["sessions"], {
        exact: true,
        where: { expiresAt: { $lt: 1234567890 } },
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.exact).toBe(true);
      expect(parsed.where).toEqual({ expiresAt: { $lt: 1234567890 } });
      expect(result.deletedCount).toBe(2);
    });
  });

  describe("list", () => {
    it("should list entries with prefix", async () => {
      mockFetch((url) => {
        if (url.includes("/keys")) {
          return new Response(
            JSON.stringify([
              { key: ["users", 1], value: { name: "Alice" }, versionstamp: "0001" },
              { key: ["users", 2], value: { name: "Bob" }, versionstamp: "0002" },
            ]),
          );
        }
        return new Response("", { status: 404 });
      });

      const entries = [];
      for await (const entry of kv.list(["users"])) {
        entries.push(entry);
      }

      expect(entries.length).toBe(2);
    });

    it("should pass list options", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.list(["users"], {
        limit: 10,
        reverse: true,
      })) {
        entries.push(entry);
      }

      expect(capturedUrl).toContain("prefix=users");
      expect(capturedUrl).toContain("limit=10");
      expect(capturedUrl).toContain("reverse=true");
    });

    it("should list with where filter using POST endpoint", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      let capturedBody = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? "GET";
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify([
            { key: ["users", 1], value: { name: "Alice", status: "active" }, versionstamp: "0001" },
          ]),
        );
      });

      const entries = [];
      for await (const entry of kv.list(["users"], {
        where: { status: { $eq: "active" } },
      })) {
        entries.push(entry);
      }

      expect(capturedUrl).toContain("/keys/list");
      expect(capturedMethod).toBe("POST");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.prefix).toEqual(["users"]);
      expect(parsed.where).toEqual({ status: { $eq: "active" } });
      expect(entries.length).toBe(1);
    });

    it("should list with complex where filter", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify([
            {
              key: ["users", 1],
              value: { name: "Alice", age: 25, city: "SP" },
              versionstamp: "0001",
            },
          ]),
        );
      });

      const entries = [];
      for await (const entry of kv.list(["users"], {
        where: {
          age: { $gt: 18 },
          city: { $eq: "SP" },
        },
      })) {
        entries.push(entry);
      }

      const parsed = JSON.parse(capturedBody);
      expect(parsed.where.age.$gt).toBe(18);
      expect(parsed.where.city.$eq).toBe("SP");
      expect(entries.length).toBe(1);
    });

    it("should list with $or filter", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.list(["users"], {
        where: {
          $or: [{ status: { $eq: "active" } }, { status: { $eq: "pending" } }],
        },
      })) {
        entries.push(entry);
      }

      const parsed = JSON.parse(capturedBody);
      expect(parsed.where.$or).toHaveLength(2);
      expect(parsed.where.$or[0]).toEqual({ status: { $eq: "active" } });
      expect(parsed.where.$or[1]).toEqual({ status: { $eq: "pending" } });
    });

    it("should list with $in filter", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.list(["users"], {
        where: { role: { $in: ["admin", "moderator"] } },
      })) {
        entries.push(entry);
      }

      const parsed = JSON.parse(capturedBody);
      expect(parsed.where.role.$in).toEqual(["admin", "moderator"]);
    });

    it("should pass all options with where filter", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.list(["users"], {
        limit: 50,
        reverse: true,
        where: { status: { $eq: "active" } },
      })) {
        entries.push(entry);
      }

      const parsed = JSON.parse(capturedBody);
      expect(parsed.prefix).toEqual(["users"]);
      expect(parsed.limit).toBe(50);
      expect(parsed.reverse).toBe(true);
      expect(parsed.where.status.$eq).toBe("active");
    });

    it("should serialize $now placeholder in where filter", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.list(["sessions"], {
        where: { expiresAt: { $gt: kv.now() } },
      })) {
        entries.push(entry);
      }

      const parsed = JSON.parse(capturedBody);
      expect(parsed.where.expiresAt.$gt).toEqual({ $now: true });
    });

    it("should use GET endpoint when no where filter provided", async () => {
      let capturedMethod = "";
      mockFetch((_url, init) => {
        capturedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.list(["users"])) {
        entries.push(entry);
      }

      expect(capturedMethod).toBe("GET");
    });
  });

  describe("count", () => {
    it("should count entries with prefix", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ count: 42 }));
      });

      const count = await kv.count(["users"]);

      expect(capturedUrl).toContain("/keys/count");
      expect(capturedUrl).toContain("prefix=users");
      expect(count).toBe(42);
    });

    it("should count all entries when prefix is empty", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ count: 100 }));
      });

      const count = await kv.count([]);

      expect(capturedUrl).toContain("/keys/count");
      expect(capturedUrl).not.toContain("prefix=");
      expect(count).toBe(100);
    });
  });

  describe("paginate", () => {
    it("should paginate entries with cursor", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            entries: [
              { key: ["users", 1], value: { name: "Alice" }, versionstamp: "0001" },
              { key: ["users", 2], value: { name: "Bob" }, versionstamp: "0002" },
            ],
            cursor: "abc123",
            hasMore: true,
          }),
        );
      });

      const result = await kv.paginate(["users"], { limit: 2 });

      expect(capturedUrl).toContain("/keys/paginate");
      expect(capturedUrl).toContain("prefix=users");
      expect(capturedUrl).toContain("limit=2");
      expect(result.entries.length).toBe(2);
      expect(result.cursor).toBe("abc123");
      expect(result.hasMore).toBe(true);
    });

    it("should pass cursor from previous page", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            entries: [{ key: ["users", 3], value: { name: "Charlie" }, versionstamp: "0003" }],
            cursor: null,
            hasMore: false,
          }),
        );
      });

      const result = await kv.paginate(["users"], {
        limit: 2,
        cursor: "abc123",
      });

      expect(capturedUrl).toContain("cursor=abc123");
      expect(result.entries.length).toBe(1);
      expect(result.cursor).toBe(null);
      expect(result.hasMore).toBe(false);
    });

    it("should support reverse pagination", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            entries: [],
            cursor: null,
            hasMore: false,
          }),
        );
      });

      await kv.paginate(["users"], { reverse: true });

      expect(capturedUrl).toContain("reverse=true");
    });
  });

  describe("atomic", () => {
    it("should create atomic operation builder", () => {
      const atomic = kv.atomic();
      expect(atomic).toBeDefined();
    });

    it("should commit atomic operations via /atomic endpoint", async () => {
      let capturedBody: unknown = null;
      mockFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ ok: true, versionstamp: "0001" }));
      });

      const result = await kv
        .atomic()
        .check({ key: ["counter"], versionstamp: "0000" })
        .set(["counter"], 1)
        .commit();

      expect(result.ok).toBe(true);
      expect(capturedBody).toEqual({
        checks: [{ key: ["counter"], versionstamp: "0000" }],
        mutations: [{ type: "set", key: ["counter"], value: 1, expiresIn: undefined }],
      });
    });

    it("should support all mutation types", async () => {
      let capturedBody: unknown = null;
      mockFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ ok: true, versionstamp: "0001" }));
      });

      await kv
        .atomic()
        .set(["key1"], "value")
        .delete(["key2"])
        .sum(["counter"], 10n)
        .max(["max"], 100n)
        .min(["min"], 1n)
        .append(["list"], [1, 2])
        .prepend(["list2"], [0])
        .commit();

      const body = capturedBody as { mutations: { type: string; value?: unknown }[] };
      expect(body.mutations.length).toBe(7);
      expect(body.mutations.map((m) => m.type)).toEqual([
        "set",
        "delete",
        "sum",
        "max",
        "min",
        "append",
        "prepend",
      ]);

      // BigInt values should be serialized as { __type: "bigint", value: string }
      const sumMutation = body.mutations.find((m) => m.type === "sum");
      expect(sumMutation?.value).toEqual({ __type: "bigint", value: "10" });
    });
  });
});

describe("KvTransaction", () => {
  let kv: Kv;

  beforeEach(() => {
    kv = new Kv("http://localhost:8000/api/keyval");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("transaction", () => {
    it("should execute transaction and return result", async () => {
      mockFetch((url) => {
        if (url.includes("/keys/balance")) {
          return new Response(
            JSON.stringify({ key: ["balance"], value: 100, versionstamp: "0001" }),
          );
        }
        if (url.includes("/atomic")) {
          return new Response(JSON.stringify({ ok: true, versionstamp: "0002" }));
        }
        return new Response("", { status: 404 });
      });

      const result = await kv.transaction(async (tx) => {
        const balance = await tx.get<number>(["balance"]);
        tx.set(["balance"], (balance.value ?? 0) - 30);
        return { newBalance: (balance.value ?? 0) - 30 };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.newBalance).toBe(70);
        expect(result.versionstamp).toBe("0002");
      }
    });

    it("should cache reads within transaction", async () => {
      let getCount = 0;
      mockFetch((url) => {
        if (url.includes("/keys/data")) {
          getCount++;
          return new Response(
            JSON.stringify({ key: ["data"], value: "cached", versionstamp: "0001" }),
          );
        }
        if (url.includes("/atomic")) {
          return new Response(JSON.stringify({ ok: true, versionstamp: "0002" }));
        }
        return new Response("", { status: 404 });
      });

      await kv.transaction(async (tx) => {
        await tx.get(["data"]);
        await tx.get(["data"]); // Should be cached
        await tx.get(["data"]); // Should be cached
        return {};
      });

      expect(getCount).toBe(1); // Only one actual fetch
    });

    it("should return error on conflict", async () => {
      mockFetch((url) => {
        if (url.includes("/keys/")) {
          return new Response(JSON.stringify({ key: ["key"], value: 1, versionstamp: "0001" }));
        }
        if (url.includes("/atomic")) {
          return new Response(JSON.stringify({ ok: false }));
        }
        return new Response("", { status: 404 });
      });

      const result = await kv.transaction(async (tx) => {
        await tx.get(["key"]);
        tx.set(["key"], 2);
        return { done: true };
      });

      expect(result.ok).toBe(false);
    });

    it("should retry on conflict when configured", async () => {
      let attempts = 0;
      mockFetch((url) => {
        if (url.includes("/keys/")) {
          return new Response(
            JSON.stringify({ key: ["key"], value: attempts, versionstamp: `000${attempts}` }),
          );
        }
        if (url.includes("/atomic")) {
          attempts++;
          // Fail first two attempts, succeed on third
          if (attempts < 3) {
            return new Response(JSON.stringify({ ok: false }));
          }
          return new Response(JSON.stringify({ ok: true, versionstamp: "0003" }));
        }
        return new Response("", { status: 404 });
      });

      const result = await kv.transaction(
        async (tx) => {
          await tx.get(["key"]);
          tx.set(["key"], 1);
          return { attempts };
        },
        { maxRetries: 5, retryDelay: 1 },
      );

      expect(result.ok).toBe(true);
      expect(attempts).toBe(3);
    });

    it("should propagate errors from transaction function", async () => {
      mockFetch(() => new Response("", { status: 404 }));

      await expect(
        kv.transaction(async () => {
          throw new Error("Business logic error");
        }),
      ).rejects.toThrow("Business logic error");
    });
  });

  describe("transaction operations", () => {
    it("should support get with multiple keys", async () => {
      mockFetch((url) => {
        if (url.includes("/keys/batch")) {
          return new Response(
            JSON.stringify([
              { key: ["a"], value: 1, versionstamp: "0001" },
              { key: ["b"], value: 2, versionstamp: "0002" },
            ]),
          );
        }
        if (url.includes("/atomic")) {
          return new Response(JSON.stringify({ ok: true, versionstamp: "0003" }));
        }
        return new Response("", { status: 404 });
      });

      const result = await kv.transaction(async (tx) => {
        const entries = await tx.get<number>([["a"], ["b"]]);
        const sum = entries.reduce((acc, e) => acc + (e.value ?? 0), 0);
        tx.set(["sum"], sum);
        return { sum };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sum).toBe(3);
      }
    });

    it("should support delete operation", async () => {
      let capturedBody: unknown = null;
      mockFetch((url, init) => {
        if (url.includes("/keys/")) {
          return new Response(
            JSON.stringify({ key: ["key"], value: "exists", versionstamp: "0001" }),
          );
        }
        if (url.includes("/atomic")) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(JSON.stringify({ ok: true, versionstamp: "0002" }));
        }
        return new Response("", { status: 404 });
      });

      await kv.transaction(async (tx) => {
        await tx.get(["key"]);
        tx.delete(["key"]);
        return {};
      });

      const body = capturedBody as { mutations: { type: string }[] };
      expect(body.mutations.some((m) => m.type === "delete")).toBe(true);
    });

    it("should support sum, max, min operations", async () => {
      let capturedBody: unknown = null;
      mockFetch((url, init) => {
        if (url.includes("/keys/")) {
          return new Response(JSON.stringify({ key: ["key"], value: 100, versionstamp: "0001" }));
        }
        if (url.includes("/atomic")) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(JSON.stringify({ ok: true, versionstamp: "0002" }));
        }
        return new Response("", { status: 404 });
      });

      await kv.transaction(async (tx) => {
        await tx.get(["counter"]);
        tx.sum(["counter"], 10n);
        tx.max(["max"], 100n);
        tx.min(["min"], 1n);
        return {};
      });

      const body = capturedBody as { mutations: { type: string; value?: unknown }[] };
      expect(body.mutations.map((m) => m.type)).toContain("sum");
      expect(body.mutations.map((m) => m.type)).toContain("max");
      expect(body.mutations.map((m) => m.type)).toContain("min");

      // BigInt values should be serialized properly
      const sumMutation = body.mutations.find((m) => m.type === "sum");
      expect(sumMutation?.value).toEqual({ __type: "bigint", value: "10" });
    });
  });
});

describe("Kv Queue", () => {
  let kv: Kv;

  beforeEach(() => {
    kv = new Kv("http://localhost:8000/api/keyval");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("enqueue", () => {
    it("should enqueue a message", async () => {
      let capturedBody: unknown = null;
      mockFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ ok: true, id: "msg-123" }));
      });

      const result = await kv.enqueue({ type: "email", to: "user@example.com" });

      expect(result.ok).toBe(true);
      expect(result.id).toBe("msg-123");
      expect(capturedBody).toEqual({
        value: { type: "email", to: "user@example.com" },
        options: undefined,
      });
    });

    it("should pass enqueue options", async () => {
      let capturedBody: unknown = null;
      mockFetch((_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ ok: true, id: "msg-123" }));
      });

      await kv.enqueue(
        { data: "test" },
        {
          delay: 5000,
          backoffSchedule: [1000, 5000],
          keysIfUndelivered: [["failed", "msg"]],
        },
      );

      const body = capturedBody as { options: Record<string, unknown> };
      expect(body.options).toEqual({
        delay: 5000,
        backoffSchedule: [1000, 5000],
        keysIfUndelivered: [["failed", "msg"]],
      });
    });
  });

  describe("queueStats", () => {
    it("should return queue statistics", async () => {
      mockFetch(() => {
        return new Response(
          JSON.stringify({
            pending: 10,
            processing: 2,
            dlq: 1,
            total: 13,
          }),
        );
      });

      const stats = await kv.queueStats();

      expect(stats.pending).toBe(10);
      expect(stats.processing).toBe(2);
      expect(stats.dlq).toBe(1);
      expect(stats.total).toBe(13);
    });
  });

  describe("ackMessage", () => {
    it("should acknowledge a message", async () => {
      let capturedBody: unknown = null;
      let capturedUrl = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init?.body as string);
        return new Response("");
      });

      await kv.ackMessage("msg-123");

      expect(capturedUrl).toContain("/queue/ack");
      expect(capturedBody).toEqual({ id: "msg-123" });
    });
  });

  describe("nackMessage", () => {
    it("should negative acknowledge a message", async () => {
      let capturedBody: unknown = null;
      let capturedUrl = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init?.body as string);
        return new Response("");
      });

      await kv.nackMessage("msg-123");

      expect(capturedUrl).toContain("/queue/nack");
      expect(capturedBody).toEqual({ id: "msg-123" });
    });
  });
});

describe("Kv DLQ", () => {
  let kv: Kv;

  beforeEach(() => {
    kv = new Kv("http://localhost:8000/api/keyval");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("dlq.list", () => {
    it("should list DLQ messages", async () => {
      mockFetch(() => {
        return new Response(
          JSON.stringify([
            {
              id: "dlq-1",
              originalId: "msg-1",
              value: { data: "test" },
              errorMessage: "Failed",
              attempts: 3,
              originalCreatedAt: 1000,
              failedAt: 2000,
            },
          ]),
        );
      });

      const messages = await kv.dlq.list();

      expect(messages.length).toBe(1);
      expect(messages[0]?.id).toBe("dlq-1");
      expect(messages[0]?.errorMessage).toBe("Failed");
    });

    it("should pass pagination options", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify([]));
      });

      await kv.dlq.list({ limit: 10, offset: 20 });

      expect(capturedUrl).toContain("limit=10");
      expect(capturedUrl).toContain("offset=20");
    });
  });

  describe("dlq.get", () => {
    it("should get a specific DLQ message", async () => {
      mockFetch(() => {
        return new Response(
          JSON.stringify({
            id: "dlq-1",
            originalId: "msg-1",
            value: { data: "test" },
            errorMessage: "Failed",
            attempts: 3,
            originalCreatedAt: 1000,
            failedAt: 2000,
          }),
        );
      });

      const message = await kv.dlq.get("dlq-1");

      expect(message?.id).toBe("dlq-1");
    });

    it("should return null for non-existent message", async () => {
      mockFetch(() => new Response("", { status: 404 }));

      const message = await kv.dlq.get("nonexistent");

      expect(message).toBe(null);
    });
  });

  describe("dlq.requeue", () => {
    it("should requeue a DLQ message", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify({ ok: true, id: "msg-new" }));
      });

      const result = await kv.dlq.requeue("dlq-1");

      expect(capturedUrl).toContain("/queue/dlq/dlq-1/requeue");
      expect(capturedMethod).toBe("POST");
      expect(result.ok).toBe(true);
      expect(result.id).toBe("msg-new");
    });
  });

  describe("dlq.delete", () => {
    it("should delete a DLQ message", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? "GET";
        return new Response("");
      });

      await kv.dlq.delete("dlq-1");

      expect(capturedUrl).toContain("/queue/dlq/dlq-1");
      expect(capturedMethod).toBe("DELETE");
    });
  });

  describe("dlq.purge", () => {
    it("should purge all DLQ messages", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? "GET";
        return new Response("");
      });

      await kv.dlq.purge();

      expect(capturedUrl).toContain("/queue/dlq");
      expect(capturedMethod).toBe("DELETE");
    });
  });
});

describe("Kv Metrics", () => {
  let kv: Kv;

  beforeEach(() => {
    kv = new Kv("http://localhost:8000/api/keyval");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("metrics (JSON)", () => {
    it("should return JSON metrics", async () => {
      mockFetch(() => {
        return new Response(
          JSON.stringify({
            operations: {
              get: { count: 100, errors: 2, avgLatencyMs: 5 },
              set: { count: 50, errors: 0, avgLatencyMs: 10 },
            },
            queue: { pending: 5, processing: 1, dlq: 0, total: 6 },
            storage: { entries: 1000, sizeBytes: 50000 },
          }),
        );
      });

      const metrics = await kv.metrics("json");

      expect(metrics.operations.get?.count).toBe(100);
      expect(metrics.queue.pending).toBe(5);
      expect(metrics.storage.entries).toBe(1000);
    });
  });

  describe("metrics (Prometheus)", () => {
    it("should return Prometheus format", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response("# HELP keyval_operations_total Total operations\n");
      });

      const text = await kv.metrics("prometheus");

      expect(capturedUrl).toContain("/metrics/prometheus");
      expect(text).toContain("keyval_operations_total");
    });
  });
});

describe("Kv Watch", () => {
  let kv: Kv;

  beforeEach(() => {
    kv = new Kv("http://localhost:8000/api/keyval");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("watch", () => {
    it("should return a handle with stop method", () => {
      mockFetch(() => {
        // Return a stream that never ends
        return new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      // Watch with exact: true (single key, no children)
      const handle = kv.watch(["test"], () => {}, { exact: true });

      expect(handle.stop).toBeDefined();
      expect(typeof handle.stop).toBe("function");

      handle.stop();
    });

    it("should watch prefix (default behavior)", () => {
      mockFetch(() => {
        return new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      // Watch prefix (includes children) - default behavior
      const handle = kv.watch(["users"], () => {});

      expect(handle.stop).toBeDefined();
      expect(typeof handle.stop).toBe("function");

      handle.stop();
    });

    it("should watch multiple prefixes", () => {
      mockFetch(() => {
        return new Response(new ReadableStream(), {
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      // Watch multiple prefixes
      const handle = kv.watch(
        [
          ["users", 123],
          ["orders", 456],
        ],
        () => {},
      );

      expect(handle.stop).toBeDefined();
      expect(typeof handle.stop).toBe("function");

      handle.stop();
    });
  });
});

describe("Kv FTS (Full-Text Search)", () => {
  let kv: Kv;

  beforeEach(() => {
    kv = new Kv("http://localhost:8000/api/keyval");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("createIndex", () => {
    it("should create index with default tokenizer", async () => {
      let capturedBody = "";
      let capturedUrl = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedBody = init?.body as string;
        return new Response("");
      });

      await kv.createIndex(["posts"], {
        fields: ["title", "content"],
      });

      expect(capturedUrl).toContain("/indexes");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.prefix).toEqual(["posts"]);
      expect(parsed.fields).toEqual(["title", "content"]);
      expect(parsed.tokenize).toBe("unicode61");
    });

    it("should create index with custom tokenizer", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response("");
      });

      await kv.createIndex(["articles"], {
        fields: ["body"],
        tokenize: "porter",
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.prefix).toEqual(["articles"]);
      expect(parsed.fields).toEqual(["body"]);
      expect(parsed.tokenize).toBe("porter");
    });

    it("should create index on nested fields", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response("");
      });

      await kv.createIndex(["users"], {
        fields: ["profile.bio", "profile.location"],
        tokenize: "ascii",
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.fields).toEqual(["profile.bio", "profile.location"]);
      expect(parsed.tokenize).toBe("ascii");
    });
  });

  describe("search", () => {
    it("should search with simple query", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify([
            { key: ["posts", 1], value: { title: "TypeScript Guide" }, versionstamp: "0001" },
            { key: ["posts", 2], value: { title: "TypeScript Tips" }, versionstamp: "0002" },
          ]),
        );
      });

      const entries = [];
      for await (const entry of kv.search(["posts"], "typescript")) {
        entries.push(entry);
      }

      expect(capturedUrl).toContain("/search");
      expect(capturedUrl).toContain("prefix=posts");
      expect(capturedUrl).toContain("query=typescript");
      expect(entries.length).toBe(2);
    });

    it("should search with limit option", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.search(["posts"], "react", { limit: 10 })) {
        entries.push(entry);
      }

      expect(capturedUrl).toContain("limit=10");
    });

    it("should search with reverse option", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.search(["posts"], "nodejs", { reverse: true })) {
        entries.push(entry);
      }

      expect(capturedUrl).toContain("reverse=true");
    });

    it("should search with where filter using POST", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      let capturedBody = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? "GET";
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify([
            {
              key: ["posts", 1],
              value: { title: "Database Guide", status: "published" },
              versionstamp: "0001",
            },
          ]),
        );
      });

      const entries = [];
      for await (const entry of kv.search(["posts"], "database", {
        where: { status: { $eq: "published" } },
      })) {
        entries.push(entry);
      }

      expect(capturedUrl).toContain("/search");
      expect(capturedMethod).toBe("POST");
      const parsed = JSON.parse(capturedBody);
      expect(parsed.prefix).toEqual(["posts"]);
      expect(parsed.query).toBe("database");
      expect(parsed.where).toEqual({ status: { $eq: "published" } });
      expect(entries.length).toBe(1);
    });

    it("should search with complex where filter", async () => {
      let capturedBody = "";
      mockFetch((_url, init) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify([
            {
              key: ["posts", 1],
              value: { title: "JavaScript Tutorial", status: "published", views: 150 },
              versionstamp: "0001",
            },
          ]),
        );
      });

      const entries = [];
      for await (const entry of kv.search(["posts"], "javascript", {
        where: {
          $and: [{ status: { $eq: "published" } }, { views: { $gt: 100 } }],
        },
      })) {
        entries.push(entry);
      }

      const parsed = JSON.parse(capturedBody);
      expect(parsed.where.$and).toHaveLength(2);
      expect(parsed.where.$and[0]).toEqual({ status: { $eq: "published" } });
      expect(parsed.where.$and[1]).toEqual({ views: { $gt: 100 } });
      expect(entries.length).toBe(1);
    });

    it("should search with start and end options", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.search(["posts"], "test", {
        start: ["posts", 10],
        end: ["posts", 20],
      })) {
        entries.push(entry);
      }

      expect(capturedUrl).toContain("start=posts%2F10");
      expect(capturedUrl).toContain("end=posts%2F20");
    });

    it("should use GET endpoint when no where filter provided", async () => {
      let capturedMethod = "";
      mockFetch((_url, init) => {
        capturedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify([]));
      });

      const entries = [];
      for await (const entry of kv.search(["posts"], "test")) {
        entries.push(entry);
      }

      expect(capturedMethod).toBe("GET");
    });
  });

  describe("listIndexes", () => {
    it("should list all indexes", async () => {
      let capturedUrl = "";
      mockFetch((url) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify([
            {
              prefix: ["posts"],
              fields: ["title", "content"],
              tokenize: "unicode61",
            },
            {
              prefix: ["users"],
              fields: ["profile.bio"],
              tokenize: "porter",
            },
          ]),
        );
      });

      const indexes = await kv.listIndexes();

      expect(capturedUrl).toContain("/indexes");
      expect(indexes.length).toBe(2);
      expect(indexes[0]?.prefix).toEqual(["posts"]);
      expect(indexes[0]?.fields).toEqual(["title", "content"]);
      expect(indexes[0]?.tokenize).toBe("unicode61");
      expect(indexes[1]?.prefix).toEqual(["users"]);
      expect(indexes[1]?.tokenize).toBe("porter");
    });

    it("should return empty array when no indexes exist", async () => {
      mockFetch(() => {
        return new Response(JSON.stringify([]));
      });

      const indexes = await kv.listIndexes();

      expect(indexes.length).toBe(0);
    });
  });

  describe("removeIndex", () => {
    it("should remove index by prefix", async () => {
      let capturedUrl = "";
      let capturedMethod = "";
      mockFetch((url, init) => {
        capturedUrl = url;
        capturedMethod = init?.method ?? "GET";
        return new Response("");
      });

      await kv.removeIndex(["posts"]);

      expect(capturedUrl).toContain("/indexes");
      expect(capturedUrl).toContain("prefix=posts");
      expect(capturedMethod).toBe("DELETE");
    });

    it("should remove index with nested prefix", async () => {
      let capturedUrl = "";
      mockFetch((url, _init) => {
        capturedUrl = url;
        return new Response("");
      });

      await kv.removeIndex(["documents", "archived"]);

      expect(capturedUrl).toContain("prefix=documents%2Farchived");
    });
  });
});
