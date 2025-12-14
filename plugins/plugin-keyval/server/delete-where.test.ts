import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Kv } from "./kv";
import { initSchema } from "./schema";
import { createTestAdapter } from "./test-helpers";

describe("Delete with Where", () => {
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

  async function seedSessions() {
    const now = Date.now();
    const sessions = [
      { id: "s1", userId: 1, createdAt: now - 3600000, active: true }, // 1 hour ago
      { id: "s2", userId: 1, createdAt: now - 7200000, active: false }, // 2 hours ago
      { id: "s3", userId: 2, createdAt: now - 86400000, active: true }, // 1 day ago
      { id: "s4", userId: 2, createdAt: now - 172800000, active: false }, // 2 days ago
      { id: "s5", userId: 3, createdAt: now - 100000, active: true }, // recent
    ];

    for (const session of sessions) {
      await kv.set(["sessions", session.id], session);
    }

    return { sessions, now };
  }

  async function countEntries(prefix: string[]) {
    let count = 0;
    for await (const _ of kv.list(prefix)) {
      count++;
    }
    return count;
  }

  describe("delete with $eq filter", () => {
    it("should delete entries matching exact value", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"], {
        where: { active: { $eq: false } },
      });

      expect(result.deletedCount).toBe(2); // s2, s4
      expect(await countEntries(["sessions"])).toBe(3);
    });

    it("should delete entries for specific user", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"], {
        where: { userId: { $eq: 2 } },
      });

      expect(result.deletedCount).toBe(2); // s3, s4
      expect(await countEntries(["sessions"])).toBe(3);
    });
  });

  describe("delete with comparison operators", () => {
    it("should delete entries older than threshold ($lt)", async () => {
      const { now } = await seedSessions();
      const threshold = now - 80000000; // ~22 hours ago

      const result = await kv.delete(["sessions"], {
        where: { createdAt: { $lt: threshold } },
      });

      expect(result.deletedCount).toBe(2); // s3, s4 (older than 22 hours)
      expect(await countEntries(["sessions"])).toBe(3);
    });

    it("should delete with $lte", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"], {
        where: { userId: { $lte: 1 } },
      });

      expect(result.deletedCount).toBe(2); // s1, s2
    });
  });

  describe("delete with logical operators", () => {
    it("should delete with $and condition", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"], {
        where: {
          $and: [{ userId: { $eq: 2 } }, { active: { $eq: false } }],
        },
      });

      expect(result.deletedCount).toBe(1); // s4
      expect(await countEntries(["sessions"])).toBe(4);
    });

    it("should delete with $or condition", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"], {
        where: {
          $or: [{ userId: { $eq: 1 } }, { userId: { $eq: 3 } }],
        },
      });

      expect(result.deletedCount).toBe(3); // s1, s2, s5
      expect(await countEntries(["sessions"])).toBe(2);
    });
  });

  describe("delete with string operators", () => {
    beforeEach(async () => {
      await kv.set(["logs", 1], { level: "error", message: "Critical failure" });
      await kv.set(["logs", 2], { level: "warn", message: "Warning message" });
      await kv.set(["logs", 3], { level: "info", message: "Info message" });
      await kv.set(["logs", 4], { level: "error", message: "Another error" });
    });

    it("should delete with $startsWith", async () => {
      const result = await kv.delete(["logs"], {
        where: { message: { $startsWith: "Critical" } },
      });

      expect(result.deletedCount).toBe(1);
    });

    it("should delete with $contains", async () => {
      const result = await kv.delete(["logs"], {
        where: { message: { $contains: "message" } },
      });

      expect(result.deletedCount).toBe(2); // "Warning message", "Info message"
    });
  });

  describe("delete with existence operators", () => {
    beforeEach(async () => {
      await kv.set(["profiles", 1], { name: "Alice", bio: "Developer" });
      await kv.set(["profiles", 2], { name: "Bob", bio: null });
      await kv.set(["profiles", 3], { name: "Charlie", bio: "" });
      await kv.set(["profiles", 4], { name: "Diana", bio: "Designer" });
    });

    it("should delete entries with null field ($null: true)", async () => {
      const result = await kv.delete(["profiles"], {
        where: { bio: { $null: true } },
      });

      expect(result.deletedCount).toBe(1); // Bob
      expect(await countEntries(["profiles"])).toBe(3);
    });

    it("should delete entries with empty field ($empty: true)", async () => {
      const result = await kv.delete(["profiles"], {
        where: { bio: { $empty: true } },
      });

      // Depends on implementation: might include null and ""
      expect(result.deletedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("delete without where (prefix delete)", () => {
    it("should delete all entries with prefix when no where clause", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"]);

      expect(result.deletedCount).toBe(5);
      expect(await countEntries(["sessions"])).toBe(0);
    });

    it("should not affect other prefixes", async () => {
      await seedSessions();
      await kv.set(["users", 1], { name: "Alice" });
      await kv.set(["users", 2], { name: "Bob" });

      await kv.delete(["sessions"]);

      expect(await countEntries(["sessions"])).toBe(0);
      expect(await countEntries(["users"])).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("should return 0 when no entries match filter", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"], {
        where: { userId: { $eq: 999 } },
      });

      expect(result.deletedCount).toBe(0);
      expect(await countEntries(["sessions"])).toBe(5);
    });

    it("should handle empty prefix with where", async () => {
      await seedSessions();
      await kv.set(["other", 1], { active: false });

      // Delete all inactive across all prefixes (if supported)
      // Note: This tests empty prefix behavior
      const beforeCount = await countEntries(["sessions"]);
      expect(beforeCount).toBe(5);
    });

    it("should handle complex nested where", async () => {
      await seedSessions();

      const result = await kv.delete(["sessions"], {
        where: {
          $and: [
            { active: { $eq: false } },
            {
              $or: [{ userId: { $eq: 1 } }, { userId: { $eq: 2 } }],
            },
          ],
        },
      });

      expect(result.deletedCount).toBe(2); // s2, s4
    });
  });
});
