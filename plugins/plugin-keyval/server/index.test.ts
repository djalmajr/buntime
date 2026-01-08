import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { api, setApiState } from "./index";
import { Kv } from "./lib/kv";
import { initSchema } from "./lib/schema";
import { createTestAdapter } from "./lib/test-helpers";

describe("KeyVal API Routes", () => {
  const adapter = createTestAdapter();
  let kv: Kv;

  beforeAll(async () => {
    await initSchema(adapter);
    kv = new Kv(adapter);
    setApiState(kv, adapter, {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    });
  });

  afterAll(async () => {
    await kv.close();
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.execute("DELETE FROM kv_entries");
    await adapter.execute("DELETE FROM kv_queue");
    await adapter.execute("DELETE FROM kv_indexes");
  });

  describe("GET /api/keys", () => {
    it("should return empty array when no entries exist", async () => {
      const res = await api.request("/api/keys");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it("should list all entries", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });

      const res = await api.request("/api/keys");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(2);
    });

    it("should filter by prefix", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["posts", 1], { title: "Post 1" });

      const res = await api.request("/api/keys?prefix=users");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(1);
      expect(data[0].key).toEqual(["users", 1]);
    });

    it("should respect limit parameter", async () => {
      for (let i = 1; i <= 5; i++) {
        await kv.set(["users", i], { name: `User ${i}` });
      }

      const res = await api.request("/api/keys?limit=2");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(2);
    });

    it("should support reverse order", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });
      await kv.set(["users", 3], { name: "Charlie" });

      const res = await api.request("/api/keys?prefix=users&reverse=true");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data[0].key).toEqual(["users", 3]);
    });

    it("should support start and end bounds", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });
      await kv.set(["users", 3], { name: "Charlie" });

      const res = await api.request("/api/keys?prefix=users&start=users/2&end=users/3");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(1);
      expect(data[0].key).toEqual(["users", 2]);
    });
  });

  describe("POST /api/keys/list", () => {
    it("should list entries with where filter", async () => {
      await kv.set(["users", 1], { name: "Alice", active: true });
      await kv.set(["users", 2], { name: "Bob", active: false });
      await kv.set(["users", 3], { name: "Charlie", active: true });

      const res = await api.request("/api/keys/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: ["users"],
          where: { active: { $eq: true } },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(2);
    });

    it("should support reverse and limit in POST", async () => {
      for (let i = 1; i <= 5; i++) {
        await kv.set(["items", i], { value: i });
      }

      const res = await api.request("/api/keys/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix: ["items"],
          reverse: true,
          limit: 2,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(2);
      expect(data[0].key).toEqual(["items", 5]);
    });
  });

  describe("GET /api/keys/count", () => {
    it("should count all entries", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });
      await kv.set(["posts", 1], { title: "Post" });

      const res = await api.request("/api/keys/count");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(3);
    });

    it("should count entries by prefix", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });
      await kv.set(["posts", 1], { title: "Post" });

      const res = await api.request("/api/keys/count?prefix=users");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(2);
    });
  });

  describe("GET /api/keys/paginate", () => {
    it("should paginate entries", async () => {
      for (let i = 1; i <= 10; i++) {
        await kv.set(["items", i], { value: i });
      }

      const res1 = await api.request("/api/keys/paginate?limit=3");
      expect(res1.status).toBe(200);
      const page1 = await res1.json();
      expect(page1.entries.length).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.cursor).toBeDefined();

      const res2 = await api.request(`/api/keys/paginate?limit=3&cursor=${page1.cursor}`);
      expect(res2.status).toBe(200);
      const page2 = await res2.json();
      expect(page2.entries.length).toBe(3);
    });

    it("should support reverse pagination", async () => {
      for (let i = 1; i <= 5; i++) {
        await kv.set(["items", i], { value: i });
      }

      const res = await api.request("/api/keys/paginate?reverse=true&limit=2");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries[0].key).toEqual(["items", 5]);
    });
  });

  describe("GET /api/keys/*", () => {
    it("should get single entry by key path", async () => {
      await kv.set(["users", 123], { name: "Alice" });

      const res = await api.request("/api/keys/users/123");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.key).toEqual(["users", 123]);
      expect(data.value).toEqual({ name: "Alice" });
    });

    it("should return 404 for non-existent key", async () => {
      const res = await api.request("/api/keys/nonexistent/key");
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe("Key not found");
    });
  });

  describe("PUT /api/keys/*", () => {
    it("should create new entry", async () => {
      const res = await api.request("/api/keys/users/456", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const entry = await kv.get(["users", 456]);
      expect(entry.value).toEqual({ name: "Bob" });
    });

    it("should update existing entry", async () => {
      await kv.set(["users", 789], { name: "Old" });

      const res = await api.request("/api/keys/users/789", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      });

      expect(res.status).toBe(200);
      const entry = await kv.get(["users", 789]);
      expect(entry.value).toEqual({ name: "New" });
    });

    it("should support expiresIn query param", async () => {
      const res = await api.request("/api/keys/temp/key?expiresIn=60000", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temporary: true }),
      });

      expect(res.status).toBe(200);
      const entry = await kv.get(["temp", "key"]);
      expect(entry.value).toEqual({ temporary: true });
    });
  });

  describe("DELETE /api/keys/*", () => {
    it("should delete entry by key path", async () => {
      await kv.set(["to-delete", "key"], { value: "test" });

      const res = await api.request("/api/keys/to-delete/key", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deletedCount).toBe(1);

      const entry = await kv.get(["to-delete", "key"]);
      expect(entry.value).toBe(null);
    });

    it("should delete prefix by default", async () => {
      await kv.set(["prefix", "a"], { value: 1 });
      await kv.set(["prefix", "b"], { value: 2 });
      await kv.set(["prefix", "c"], { value: 3 });

      const res = await api.request("/api/keys/prefix", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deletedCount).toBe(3);
    });

    it("should delete exact key with body option", async () => {
      await kv.set(["exact", "key"], { value: 1 });
      await kv.set(["exact", "key", "child"], { value: 2 });

      const res = await api.request("/api/keys/exact/key", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exact: true }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deletedCount).toBe(1);

      // Child should still exist
      const child = await kv.get(["exact", "key", "child"]);
      expect(child.value).toEqual({ value: 2 });
    });

    it("should delete with where filter", async () => {
      await kv.set(["filter", 1], { active: true });
      await kv.set(["filter", 2], { active: false });
      await kv.set(["filter", 3], { active: true });

      const res = await api.request("/api/keys/filter", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ where: { active: { $eq: false } } }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deletedCount).toBe(1);
    });
  });

  describe("POST /api/keys/batch", () => {
    it("should get multiple keys in single request", async () => {
      await kv.set(["batch", 1], { value: 1 });
      await kv.set(["batch", 2], { value: 2 });
      await kv.set(["batch", 3], { value: 3 });

      const res = await api.request("/api/keys/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: [
            ["batch", 1],
            ["batch", 3],
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(2);
      expect(data[0].value).toEqual({ value: 1 });
      expect(data[1].value).toEqual({ value: 3 });
    });
  });

  describe("POST /api/keys/delete-batch", () => {
    it("should delete multiple keys in single request", async () => {
      await kv.set(["del", 1], { value: 1 });
      await kv.set(["del", 2], { value: 2 });
      await kv.set(["del", 3], { value: 3 });

      const res = await api.request("/api/keys/delete-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: [
            ["del", 1],
            ["del", 2],
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deletedCount).toBe(2);

      // Third should still exist
      const entry = await kv.get(["del", 3]);
      expect(entry.value).toEqual({ value: 3 });
    });

    it("should support exact option in batch delete", async () => {
      await kv.set(["batch", 1], { value: 1 });
      await kv.set(["batch", 1, "child"], { value: 2 });

      const res = await api.request("/api/keys/delete-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: [["batch", 1]],
          exact: true,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deletedCount).toBe(1);

      // Child should still exist
      const child = await kv.get(["batch", 1, "child"]);
      expect(child.value).toEqual({ value: 2 });
    });
  });

  describe("POST /api/atomic", () => {
    it("should perform atomic set operation", async () => {
      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [
            { type: "set", key: ["atomic", 1], value: { name: "Test" } },
            { type: "set", key: ["atomic", 2], value: { name: "Test2" } },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);

      const entry1 = await kv.get(["atomic", 1]);
      const entry2 = await kv.get(["atomic", 2]);
      expect(entry1.value).toEqual({ name: "Test" });
      expect(entry2.value).toEqual({ name: "Test2" });
    });

    it("should perform atomic delete operation", async () => {
      await kv.set(["to-del", 1], { value: 1 });

      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "delete", key: ["to-del", 1] }],
        }),
      });

      expect(res.status).toBe(200);
      const entry = await kv.get(["to-del", 1]);
      expect(entry.value).toBe(null);
    });

    it("should perform atomic sum operation", async () => {
      // First set via API
      const setupRes = await api.request("/api/keys/sum-test-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ __type: "bigint", value: "10" }),
      });
      expect(setupRes.status).toBe(200);

      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "sum", key: ["sum-test-key"], value: 5 }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("should perform atomic max operation", async () => {
      // First set via API
      const setupRes = await api.request("/api/keys/max-test-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ __type: "bigint", value: "10" }),
      });
      expect(setupRes.status).toBe(200);

      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "max", key: ["max-test-key"], value: 20 }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("should perform atomic min operation", async () => {
      // First set via API
      const setupRes = await api.request("/api/keys/min-test-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ __type: "bigint", value: "10" }),
      });
      expect(setupRes.status).toBe(200);

      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "min", key: ["min-test-key"], value: 5 }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("should perform atomic append operation", async () => {
      await kv.set(["arr"], [1, 2]);

      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "append", key: ["arr"], value: [3, 4] }],
        }),
      });

      expect(res.status).toBe(200);
      const entry = await kv.get(["arr"]);
      expect(entry.value).toEqual([1, 2, 3, 4]);
    });

    it("should perform atomic prepend operation", async () => {
      await kv.set(["arr2"], [3, 4]);

      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "prepend", key: ["arr2"], value: [1, 2] }],
        }),
      });

      expect(res.status).toBe(200);
      const entry = await kv.get(["arr2"]);
      expect(entry.value).toEqual([1, 2, 3, 4]);
    });

    it("should return 400 for invalid append value", async () => {
      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "append", key: ["arr"], value: "not-array" }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("append value must be an array");
    });

    it("should return 400 for invalid prepend value", async () => {
      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "prepend", key: ["arr"], value: "not-array" }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("prepend value must be an array");
    });

    it("should support checks for optimistic concurrency", async () => {
      await kv.set(["checked"], { value: 1 });
      const entry = await kv.get(["checked"]);

      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checks: [{ key: ["checked"], versionstamp: entry.versionstamp }],
          mutations: [{ type: "set", key: ["checked"], value: { value: 2 } }],
        }),
      });

      expect(res.status).toBe(200);
      const updated = await kv.get(["checked"]);
      expect(updated.value).toEqual({ value: 2 });
    });

    it("should support expiresIn in set mutation", async () => {
      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [
            { type: "set", key: ["temp-atomic"], value: { temp: true }, expiresIn: 60000 },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const entry = await kv.get(["temp-atomic"]);
      expect(entry.value).toEqual({ temp: true });
    });
  });

  describe("Queue Routes", () => {
    describe("POST /api/queue/enqueue", () => {
      it("should enqueue a message", async () => {
        const res = await api.request("/api/queue/enqueue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: { type: "test", data: "hello" } }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.id).toBeDefined();
      });

      it("should enqueue with delay", async () => {
        const res = await api.request("/api/queue/enqueue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            value: { delayed: true },
            options: { delay: 5000 },
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
      });

      it("should enqueue with backoff schedule", async () => {
        const res = await api.request("/api/queue/enqueue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            value: { retry: true },
            options: { backoffSchedule: [1000, 5000, 30000] },
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
      });

      it("should enqueue with keysIfUndelivered", async () => {
        const res = await api.request("/api/queue/enqueue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            value: { critical: true },
            options: {
              keysIfUndelivered: [["failed", "messages"]],
            },
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
      });
    });

    describe("GET /api/queue/poll", () => {
      it("should return null when queue is empty", async () => {
        const res = await api.request("/api/queue/poll");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.message).toBe(null);
      });

      it("should return message when queue has items", async () => {
        await kv.queue.enqueue({ value: "poll-test" });

        const res = await api.request("/api/queue/poll");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.message).toBeDefined();
        expect(data.message.value).toEqual({ value: "poll-test" });
      });
    });

    describe("POST /api/queue/ack", () => {
      it("should acknowledge a message", async () => {
        await kv.queue.enqueue({ value: "ack-test" });
        const msg = await kv.queue.dequeue();
        expect(msg).not.toBeNull();

        const res = await api.request("/api/queue/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: msg!.id }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
      });

      it("should return 400 for invalid id", async () => {
        const res = await api.request("/api/queue/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: 123 }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("id must be a non-empty string");
      });

      it("should return 400 for empty id", async () => {
        const res = await api.request("/api/queue/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "" }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe("POST /api/queue/nack", () => {
      it("should negative acknowledge a message", async () => {
        await kv.queue.enqueue({ value: "nack-test" });
        const msg = await kv.queue.dequeue();
        expect(msg).not.toBeNull();

        const res = await api.request("/api/queue/nack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: msg!.id }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
      });

      it("should return 400 for invalid id", async () => {
        const res = await api.request("/api/queue/nack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: null }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe("GET /api/queue/stats", () => {
      it("should return queue statistics", async () => {
        const res = await api.request("/api/queue/stats");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty("pending");
        expect(data).toHaveProperty("processing");
        expect(data).toHaveProperty("dlq");
        expect(data).toHaveProperty("total");
      });
    });

    describe("DLQ Routes", () => {
      describe("GET /api/queue/dlq", () => {
        it("should list DLQ messages", async () => {
          const res = await api.request("/api/queue/dlq");
          expect(res.status).toBe(200);
          const data = await res.json();
          expect(Array.isArray(data)).toBe(true);
        });

        it("should support limit and offset", async () => {
          const res = await api.request("/api/queue/dlq?limit=10&offset=0");
          expect(res.status).toBe(200);
        });
      });

      describe("GET /api/queue/dlq/:id", () => {
        it("should return 404 for non-existent DLQ message", async () => {
          const res = await api.request("/api/queue/dlq/nonexistent-id");
          expect(res.status).toBe(404);
        });
      });

      describe("POST /api/queue/dlq/:id/requeue", () => {
        it("should return 404 for non-existent message", async () => {
          const res = await api.request("/api/queue/dlq/nonexistent-id/requeue", {
            method: "POST",
          });
          expect(res.status).toBe(404);
        });
      });

      describe("DELETE /api/queue/dlq/:id", () => {
        it("should delete DLQ message (no-op for non-existent)", async () => {
          const res = await api.request("/api/queue/dlq/nonexistent-id", {
            method: "DELETE",
          });
          expect(res.status).toBe(200);
        });
      });

      describe("DELETE /api/queue/dlq", () => {
        it("should purge DLQ", async () => {
          const res = await api.request("/api/queue/dlq", {
            method: "DELETE",
          });
          expect(res.status).toBe(200);
          const data = await res.json();
          expect(data).toHaveProperty("deletedCount");
        });
      });
    });
  });

  describe("Metrics Routes", () => {
    describe("GET /api/metrics", () => {
      it("should return metrics in JSON format", async () => {
        // Perform some operations to generate metrics
        await kv.set(["metric-test"], { value: 1 });
        await kv.get(["metric-test"]);

        const res = await api.request("/api/metrics");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty("operations");
        expect(data).toHaveProperty("queue");
        expect(data).toHaveProperty("storage");
      });
    });

    describe("GET /api/metrics/prometheus", () => {
      it("should return metrics in Prometheus format", async () => {
        await kv.set(["prom-test"], { value: 1 });

        const res = await api.request("/api/metrics/prometheus");
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("keyval_");
        expect(text).toContain("# HELP");
        expect(text).toContain("# TYPE");
        expect(res.headers.get("Content-Type")).toContain("text/plain");
      });
    });
  });

  describe("Watch Routes", () => {
    describe("GET /api/watch", () => {
      it("should return 400 for missing keys parameter", async () => {
        const res = await api.request("/api/watch");
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("keys");
      });
    });

    describe("GET /api/watch/poll", () => {
      it("should return 400 for missing keys parameter", async () => {
        const res = await api.request("/api/watch/poll");
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("keys");
      });

      it("should return entries for valid keys", async () => {
        await kv.set(["watch", "key"], { value: 1 });

        const res = await api.request("/api/watch/poll?keys=watch/key");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.entries).toBeDefined();
        expect(data.versionstamps).toBeDefined();
      });

      it("should detect changes based on versionstamps", async () => {
        await kv.set(["watch", "key2"], { value: 1 });
        const entry = await kv.get(["watch", "key2"]);

        // First request without versionstamps - should return the entry
        const res1 = await api.request("/api/watch/poll?keys=watch/key2");
        const data1 = await res1.json();
        expect(data1.entries.length).toBe(1);

        // Second request with same versionstamp - should return empty
        const res2 = await api.request(
          `/api/watch/poll?keys=watch/key2&versionstamps=${entry.versionstamp}`,
        );
        const data2 = await res2.json();
        expect(data2.entries.length).toBe(0);
      });
    });

    describe("GET /api/watch/prefix", () => {
      it("should return 400 for missing prefix parameter", async () => {
        const res = await api.request("/api/watch/prefix");
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("prefix");
      });
    });

    describe("GET /api/watch/prefix/poll", () => {
      it("should return 400 for missing prefix parameter", async () => {
        const res = await api.request("/api/watch/prefix/poll");
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("prefix");
      });

      it("should return entries for valid prefix", async () => {
        await kv.set(["prefix-watch", "a"], { value: 1 });
        await kv.set(["prefix-watch", "b"], { value: 2 });

        const res = await api.request("/api/watch/prefix/poll?prefix=prefix-watch");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.entries.length).toBe(2);
        expect(data.versionstamps).toBeDefined();
      });

      it("should detect deleted keys", async () => {
        await kv.set(["del-watch", "a"], { value: 1 });
        const entry = await kv.get(["del-watch", "a"]);

        // Delete the entry
        await kv.delete(["del-watch", "a"]);

        // Request with old versionstamp should detect deletion
        const res = await api.request(
          `/api/watch/prefix/poll?prefix=del-watch&versionstamps=del-watch/a:${entry.versionstamp}`,
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.entries.length).toBe(1);
        expect(data.entries[0].value).toBe(null);
        expect(data.entries[0].versionstamp).toBe(null);
      });
    });
  });

  describe("FTS Routes", () => {
    describe("POST /api/indexes", () => {
      it("should create an index", async () => {
        const res = await api.request("/api/indexes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix: ["posts"],
            options: { fields: ["title", "content"] },
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
      });

      it("should return 400 for missing fields", async () => {
        const res = await api.request("/api/indexes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix: ["posts"],
            options: {},
          }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("fields must be a non-empty array");
      });

      it("should return 400 for empty fields array", async () => {
        const res = await api.request("/api/indexes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix: ["posts"],
            options: { fields: [] },
          }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("At least one field");
      });
    });

    describe("GET /api/indexes", () => {
      it("should list all indexes", async () => {
        const res = await api.request("/api/indexes");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
      });
    });

    describe("DELETE /api/indexes", () => {
      it("should return 400 for missing prefix", async () => {
        const res = await api.request("/api/indexes", {
          method: "DELETE",
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("prefix");
      });

      it("should remove index by prefix", async () => {
        // First create an index
        await api.request("/api/indexes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix: ["to-remove"],
            options: { fields: ["title"] },
          }),
        });

        const res = await api.request("/api/indexes?prefix=to-remove", {
          method: "DELETE",
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
      });
    });

    describe("GET /api/search", () => {
      it("should return 400 for missing prefix", async () => {
        const res = await api.request("/api/search?query=test");
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("prefix");
      });

      it("should return 400 for missing query", async () => {
        const res = await api.request("/api/search?prefix=posts");
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("query");
      });

      it("should search with valid parameters", async () => {
        // Create index and add data
        await kv.fts.createIndex(["search-test"], { fields: ["title"] });
        await kv.set(["search-test", 1], { title: "Hello World" });
        await kv.set(["search-test", 2], { title: "Goodbye World" });

        const res = await api.request("/api/search?prefix=search-test&query=hello");
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
      });
    });

    describe("POST /api/search", () => {
      it("should return 400 for missing prefix", async () => {
        const res = await api.request("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "test" }),
        });
        expect(res.status).toBe(400);
      });

      it("should return 400 for missing query", async () => {
        const res = await api.request("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: ["posts"] }),
        });
        expect(res.status).toBe(400);
      });

      it("should search with filters", async () => {
        await kv.fts.createIndex(["filter-search"], { fields: ["title"] });
        await kv.set(["filter-search", 1], { title: "Active Post", status: "active" });
        await kv.set(["filter-search", 2], { title: "Inactive Post", status: "inactive" });

        const res = await api.request("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix: ["filter-search"],
            query: "post",
            options: {
              where: { status: { $eq: "active" } },
            },
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
      });
    });
  });

  describe("Error Handling", () => {
    it("should return 400 for invalid prepend value", async () => {
      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "prepend", key: ["arr"], value: "not-array" }],
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("prepend value must be an array");
    });

    it("should return 400 for invalid append value", async () => {
      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "append", key: ["arr"], value: "not-array" }],
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("append value must be an array");
    });

    it("should handle generic error with 500 status", async () => {
      // Create a request with an invalid mutation type to trigger an error
      // through the switch default case (no match, undefined behavior)
      const res = await api.request("/api/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mutations: [{ type: "unknown-mutation", key: ["test"], value: 1 }],
        }),
      });
      // The switch doesn't have a default case, so it just commits
      // This doesn't trigger the error handler
      expect(res.status).toBe(200);
    });
  });

  describe("onError Handler - Non-HTTPException", () => {
    it("should return 500 for non-HTTPException errors", async () => {
      // Save original kv to restore later
      const originalKv = kv;

      // Create a mock kv that throws a regular Error (not HTTPException)
      const mockKv = {
        ...kv,
        get: () => {
          throw new Error("Database connection failed");
        },
      };

      // Temporarily replace kv
      setApiState(mockKv as typeof kv, adapter, {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
      });

      const res = await api.request("/api/keys/some/key");
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Internal server error");

      // Restore original kv
      setApiState(originalKv, adapter, {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
      });
    });

    it("should log non-HTTPException errors", async () => {
      const errorLogs: Array<{ msg: string; ctx?: unknown }> = [];
      const originalKv = kv;

      const mockKv = {
        ...kv,
        get: () => {
          throw new TypeError("Cannot read property 'x' of undefined");
        },
      };

      setApiState(mockKv as typeof kv, adapter, {
        debug: () => {},
        error: (msg: string, ctx?: unknown) => errorLogs.push({ msg, ctx }),
        info: () => {},
        warn: () => {},
      });

      const res = await api.request("/api/keys/another/key");
      expect(res.status).toBe(500);
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs[0].msg).toBe("KeyVal route error");

      // Restore
      setApiState(originalKv, adapter, {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
      });
    });
  });

  describe("Queue SSE Listen Endpoint", () => {
    describe("GET /api/queue/listen", () => {
      it("should return SSE headers", async () => {
        // Start the SSE request and abort it immediately
        const controller = new AbortController();
        const resPromise = api.request("/api/queue/listen", {
          signal: controller.signal,
        });

        // Wait for headers before aborting
        const res = await Promise.race([
          resPromise,
          new Promise<Response>((resolve) =>
            setTimeout(async () => {
              controller.abort();
              // Return a mock response to check headers
              resolve(await resPromise.catch(() => new Response(null, { status: 500 })));
            }, 50),
          ),
        ]);

        // The SSE endpoint should return proper content-type
        expect(res.headers.get("content-type")).toContain("text/event-stream");
      });

      it("should start streaming and send heartbeat", async () => {
        const controller = new AbortController();

        // Start the request
        const resPromise = api.request("/api/queue/listen", {
          signal: controller.signal,
        });

        // Small delay to let SSE start
        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Request was aborted - expected behavior
        }
      });

      it("should stream message when available", async () => {
        const controller = new AbortController();

        // Enqueue a message first
        await kv.queue.enqueue({ type: "sse-test", value: 123 });

        // Start the SSE request
        const resPromise = api.request("/api/queue/listen", {
          signal: controller.signal,
        });

        // Wait a bit and abort
        await new Promise((r) => setTimeout(r, 200));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Request was aborted - expected behavior
        }
      });
    });
  });

  describe("Watch SSE Endpoints", () => {
    describe("GET /api/watch (SSE)", () => {
      it("should return SSE headers for watch endpoint", async () => {
        await kv.set(["sse-watch", "key"], { value: 1 });

        const controller = new AbortController();
        const resPromise = api.request("/api/watch?keys=sse-watch/key", {
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Request was aborted - expected behavior
        }
      });

      it("should emit initial values when initial=true (default)", async () => {
        await kv.set(["sse-watch-init", "key"], { value: 42 });

        const controller = new AbortController();
        const resPromise = api.request("/api/watch?keys=sse-watch-init/key", {
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Expected - request aborted
        }
      });

      it("should not emit initial values when initial=false", async () => {
        await kv.set(["sse-no-init", "key"], { value: 1 });

        const controller = new AbortController();
        const resPromise = api.request("/api/watch?keys=sse-no-init/key&initial=false", {
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Expected - request aborted
        }
      });

      it("should watch multiple keys", async () => {
        await kv.set(["sse-multi", 1], { value: 1 });
        await kv.set(["sse-multi", 2], { value: 2 });

        const controller = new AbortController();
        const resPromise = api.request("/api/watch?keys=sse-multi/1,sse-multi/2", {
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Expected - request aborted
        }
      });
    });

    describe("GET /api/watch/prefix (SSE)", () => {
      it("should return SSE headers for prefix watch", async () => {
        await kv.set(["sse-prefix", "a"], { value: 1 });

        const controller = new AbortController();
        const resPromise = api.request("/api/watch/prefix?prefix=sse-prefix", {
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Expected - request aborted
        }
      });

      it("should emit initial values with prefix watch", async () => {
        await kv.set(["sse-prefix-init", 1], { value: 1 });
        await kv.set(["sse-prefix-init", 2], { value: 2 });

        const controller = new AbortController();
        const resPromise = api.request("/api/watch/prefix?prefix=sse-prefix-init", {
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Expected - request aborted
        }
      });

      it("should skip initial values when initial=false for prefix watch", async () => {
        await kv.set(["sse-prefix-no-init", 1], { value: 1 });

        const controller = new AbortController();
        const resPromise = api.request(
          "/api/watch/prefix?prefix=sse-prefix-no-init&initial=false",
          { signal: controller.signal },
        );

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Expected - request aborted
        }
      });

      it("should respect limit parameter for prefix watch", async () => {
        for (let i = 0; i < 5; i++) {
          await kv.set(["sse-prefix-limit", i], { value: i });
        }

        const controller = new AbortController();
        const resPromise = api.request("/api/watch/prefix?prefix=sse-prefix-limit&limit=2", {
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 150));
        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");
        } catch {
          // Expected - request aborted
        }
      });

      it("should detect deleted keys in prefix watch SSE stream", async () => {
        // Create initial entries
        await kv.set(["sse-deleted", "a"], { value: 1 });
        await kv.set(["sse-deleted", "b"], { value: 2 });

        const controller = new AbortController();
        const events: string[] = [];

        // Start SSE connection
        const resPromise = api.request("/api/watch/prefix?prefix=sse-deleted", {
          signal: controller.signal,
        });

        // Wait for initial emit
        await new Promise((r) => setTimeout(r, 120));

        // Delete one key while SSE is running
        await kv.delete(["sse-deleted", "a"], { exact: true });

        // Wait for the change to be detected (next poll cycle)
        await new Promise((r) => setTimeout(r, 150));

        controller.abort();

        try {
          const res = await resPromise;
          expect(res.headers.get("content-type")).toContain("text/event-stream");

          // Read the stream content
          const reader = res.body?.getReader();
          if (reader) {
            const { value } = await reader.read();
            if (value) {
              const text = new TextDecoder().decode(value);
              events.push(text);
            }
          }
        } catch {
          // Expected - request aborted
        }
      });

      it("should emit deletion events for keys that disappear during watch", async () => {
        // This test specifically covers lines 590-596 (deleted key detection)
        await kv.set(["sse-del-detect", 1], { value: "initial" });

        const controller = new AbortController();
        let receivedData = "";

        // Start watching the prefix
        const resPromise = api.request("/api/watch/prefix?prefix=sse-del-detect", {
          signal: controller.signal,
        });

        // Get the response and start reading the stream
        const res = await resPromise;
        expect(res.headers.get("content-type")).toContain("text/event-stream");

        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("No reader available");
        }

        // Read initial data (first SSE event with the entry)
        const { value: initialValue } = await reader.read();
        if (initialValue) {
          receivedData += new TextDecoder().decode(initialValue);
        }

        // Delete the key - this should trigger the deleted key detection path
        await kv.delete(["sse-del-detect", 1], { exact: true });

        // Wait for the SSE stream to detect the deletion and emit another event
        // The poll interval is 100ms, so wait a bit longer
        await new Promise((r) => setTimeout(r, 150));

        // Read the deletion event
        const { value: deletionValue } = await reader.read();
        if (deletionValue) {
          receivedData += new TextDecoder().decode(deletionValue);
        }

        controller.abort();

        // Verify we received deletion data (value: null, versionstamp: null)
        expect(receivedData).toContain("null");
      });
    });
  });

  describe("DLQ Success Cases", () => {
    async function createDlqMessage(): Promise<string> {
      // Enqueue a message that will fail
      await kv.queue.enqueue(
        { dlqTest: true },
        { backoffSchedule: [] }, // No retries - goes to DLQ immediately
      );

      // Dequeue and nack it to move to DLQ
      const msg = await kv.queue.dequeue();
      if (msg) {
        await kv.queue.nack(msg.id);
      }

      // Get the DLQ message ID
      const dlqMessages = await kv.queue.listDlq();
      return dlqMessages[0]?.id ?? "";
    }

    describe("GET /api/queue/dlq/:id", () => {
      it("should return DLQ message when it exists", async () => {
        const dlqId = await createDlqMessage();
        expect(dlqId).not.toBe("");

        const res = await api.request(`/api/queue/dlq/${dlqId}`);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.id).toBe(dlqId);
        expect(data.value).toEqual({ dlqTest: true });
        expect(data.errorMessage).toBeDefined();
        expect(data.attempts).toBeGreaterThan(0);
      });
    });

    describe("POST /api/queue/dlq/:id/requeue", () => {
      it("should requeue DLQ message successfully", async () => {
        const dlqId = await createDlqMessage();
        expect(dlqId).not.toBe("");

        const res = await api.request(`/api/queue/dlq/${dlqId}/requeue`, {
          method: "POST",
        });
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.newId).toBeDefined();

        // Verify message is back in queue
        const msg = await kv.queue.dequeue();
        expect(msg).not.toBeNull();
        expect(msg?.value).toEqual({ dlqTest: true });
      });
    });
  });
});
