import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { LibSqlAdapter } from "@buntime/plugin-database";
import { Kv } from "../src/kv";
import { initSchema } from "../src/schema";
import type { KvTriggerEvent } from "../src/types";

describe("KvTriggers", () => {
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
    await adapter.execute("DELETE FROM kv_entries", []);
  });

  describe("addTrigger", () => {
    it("should return unsubscribe function", () => {
      const unsubscribe = kv.addTrigger({
        prefix: ["test"],
        events: ["set"],
        handler: () => {},
      });

      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });

    it("should fire trigger on set", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.set(["users", 1], { name: "Alice" });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("set");
      expect(events[0]?.key).toEqual(["users", 1]);
      expect(events[0]?.value).toEqual({ name: "Alice" });
      expect(events[0]?.versionstamp).toBeDefined();

      unsubscribe();
    });

    it("should fire trigger on delete", async () => {
      const events: KvTriggerEvent[] = [];

      await kv.set(["users", 1], { name: "Alice" });

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["delete"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.delete(["users", 1]);

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("delete");
      expect(events[0]?.key).toEqual(["users", 1]);
      expect(events[0]?.value).toBeUndefined();

      unsubscribe();
    });

    it("should not fire trigger for non-matching prefix", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.set(["posts", 1], { title: "Hello" });

      expect(events).toHaveLength(0);

      unsubscribe();
    });

    it("should not fire trigger for non-matching event type", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["delete"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.set(["users", 1], { name: "Alice" });

      expect(events).toHaveLength(0);

      unsubscribe();
    });

    it("should stop firing after unsubscribe", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.set(["users", 1], { name: "Alice" });
      expect(events).toHaveLength(1);

      unsubscribe();

      await kv.set(["users", 2], { name: "Bob" });
      expect(events).toHaveLength(1);
    });

    it("should match empty prefix (all keys)", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: [],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["posts", 1], { title: "Hello" });
      await kv.set(["comments", 1], { text: "Nice" });

      expect(events).toHaveLength(3);

      unsubscribe();
    });

    it("should support multiple triggers", async () => {
      const userEvents: KvTriggerEvent[] = [];
      const allEvents: KvTriggerEvent[] = [];

      const unsub1 = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: (event) => {
          userEvents.push(event);
        },
      });

      const unsub2 = kv.addTrigger({
        prefix: [],
        events: ["set", "delete"],
        handler: (event) => {
          allEvents.push(event);
        },
      });

      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["posts", 1], { title: "Hello" });
      await kv.delete(["users", 1]);

      expect(userEvents).toHaveLength(1);
      expect(allEvents).toHaveLength(3);

      unsub1();
      unsub2();
    });

    it("should handle async handlers", async () => {
      let processed = false;

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: async () => {
          await new Promise((r) => setTimeout(r, 10));
          processed = true;
        },
      });

      await kv.set(["users", 1], { name: "Alice" });

      expect(processed).toBe(true);

      unsubscribe();
    });

    it("should catch and log handler errors without blocking", async () => {
      const events: KvTriggerEvent[] = [];

      const unsub1 = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: () => {
          throw new Error("Handler error");
        },
      });

      const unsub2 = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      // Should not throw even though first handler throws
      await kv.set(["users", 1], { name: "Alice" });

      // Second handler should still run
      expect(events).toHaveLength(1);

      unsub1();
      unsub2();
    });
  });

  describe("triggers with atomic operations", () => {
    it("should fire triggers on atomic set", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.atomic().set(["users", 1], { name: "Alice" }).commit();

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("set");
      expect(events[0]?.key).toEqual(["users", 1]);

      unsubscribe();
    });

    it("should fire triggers on atomic delete", async () => {
      const events: KvTriggerEvent[] = [];

      await kv.set(["users", 1], { name: "Alice" });

      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["delete"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.atomic().delete(["users", 1]).commit();

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("delete");
      expect(events[0]?.key).toEqual(["users", 1]);

      unsubscribe();
    });

    it("should fire triggers for multiple atomic mutations", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: [],
        events: ["set", "delete"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv
        .atomic()
        .set(["users", 1], { name: "Alice" })
        .set(["users", 2], { name: "Bob" })
        .set(["posts", 1], { title: "Hello" })
        .commit();

      expect(events).toHaveLength(3);

      unsubscribe();
    });

    it("should fire triggers on atomic sum operation", async () => {
      const events: KvTriggerEvent[] = [];

      const unsubscribe = kv.addTrigger({
        prefix: ["counters"],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      await kv.atomic().sum(["counters", "visits"], 1n).commit();

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("set");
      expect(events[0]?.key).toEqual(["counters", "visits"]);

      unsubscribe();
    });

    it("should not fire triggers when atomic commit fails check", async () => {
      await kv.set(["users", 1], { name: "Alice" });
      const entry = await kv.get(["users", 1]);

      // Modify the entry to make the check fail (before registering trigger)
      await kv.set(["users", 1], { name: "Modified" });

      // Register trigger after modifications
      const events: KvTriggerEvent[] = [];
      const unsubscribe = kv.addTrigger({
        prefix: ["users"],
        events: ["set"],
        handler: (event) => {
          events.push(event);
        },
      });

      // This should fail due to versionstamp mismatch
      const result = await kv
        .atomic()
        .check({ key: ["users", 1], versionstamp: entry.versionstamp })
        .set(["users", 1], { name: "Bob" })
        .commit();

      expect(result.ok).toBe(false);
      // No triggers should fire for failed atomic commits
      expect(events).toHaveLength(0);

      unsubscribe();
    });
  });
});
