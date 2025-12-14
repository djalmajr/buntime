import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Kv } from "./kv";
import { initSchema } from "./schema";
import { createTestAdapter } from "./test-helpers";

describe("Where Filters", () => {
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

  // ==========================================================================
  // Test Data Setup
  // ==========================================================================

  async function seedUsers() {
    const users = [
      {
        id: 1,
        name: "Alice",
        email: "alice@example.com",
        age: 30,
        status: "active",
        tags: ["admin", "user"],
      },
      { id: 2, name: "Bob", email: "bob@test.com", age: 25, status: "inactive", tags: ["user"] },
      { id: 3, name: "Charlie", email: "charlie@example.com", age: 35, status: "active", tags: [] },
      {
        id: 4,
        name: "Diana",
        email: "diana@test.com",
        age: 28,
        status: "pending",
        tags: ["moderator"],
      },
      { id: 5, name: "Eve", email: null, age: 40, status: "active", tags: ["admin"] },
    ];

    for (const user of users) {
      await kv.set(["users", user.id], user);
    }

    return users;
  }

  async function collectList<T>(
    prefix: Parameters<typeof kv.list>[0],
    options?: Parameters<typeof kv.list>[1],
  ) {
    const entries: T[] = [];
    for await (const entry of kv.list<T>(prefix, options)) {
      entries.push(entry.value as T);
    }
    return entries;
  }

  // ==========================================================================
  // Comparison Operators
  // ==========================================================================

  describe("$eq (equal)", () => {
    it("should filter by exact string match", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { status: { $eq: "active" } },
      });

      expect(results.length).toBe(3);
      expect(results.every((u: any) => u.status === "active")).toBe(true);
    });

    it("should filter by exact number match", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $eq: 30 } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).name).toBe("Alice");
    });

    it("should support shorthand syntax (field: value)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { status: "active" },
      });

      expect(results.length).toBe(3);
    });
  });

  describe("$ne (not equal)", () => {
    it("should filter by not equal string", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { status: { $ne: "active" } },
      });

      expect(results.length).toBe(2);
      expect(results.every((u: any) => u.status !== "active")).toBe(true);
    });

    it("should filter by not equal number", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $ne: 30 } },
      });

      expect(results.length).toBe(4);
    });
  });

  describe("$gt (greater than)", () => {
    it("should filter numbers greater than value", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $gt: 30 } },
      });

      expect(results.length).toBe(2);
      expect(results.every((u: any) => u.age > 30)).toBe(true);
    });

    it("should filter strings lexicographically", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $gt: "Charlie" } },
      });

      expect(results.length).toBe(2); // Diana, Eve
    });
  });

  describe("$gte (greater than or equal)", () => {
    it("should filter numbers >= value", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $gte: 30 } },
      });

      expect(results.length).toBe(3);
      expect(results.every((u: any) => u.age >= 30)).toBe(true);
    });
  });

  describe("$lt (less than)", () => {
    it("should filter numbers less than value", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $lt: 30 } },
      });

      expect(results.length).toBe(2);
      expect(results.every((u: any) => u.age < 30)).toBe(true);
    });
  });

  describe("$lte (less than or equal)", () => {
    it("should filter numbers <= value", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $lte: 30 } },
      });

      expect(results.length).toBe(3);
      expect(results.every((u: any) => u.age <= 30)).toBe(true);
    });
  });

  describe("$between", () => {
    it("should filter numbers in range (inclusive)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $between: [25, 35] } },
      });

      expect(results.length).toBe(4);
      expect(results.every((u: any) => u.age >= 25 && u.age <= 35)).toBe(true);
    });
  });

  // ==========================================================================
  // Array Operators
  // ==========================================================================

  describe("$in", () => {
    it("should filter by value in array", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { status: { $in: ["active", "pending"] } },
      });

      expect(results.length).toBe(4);
      expect(results.every((u: any) => ["active", "pending"].includes(u.status))).toBe(true);
    });

    it("should filter numbers in array", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $in: [25, 30, 40] } },
      });

      expect(results.length).toBe(3);
    });
  });

  describe("$nin (not in)", () => {
    it("should filter by value not in array", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { status: { $nin: ["active", "pending"] } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).status).toBe("inactive");
    });
  });

  // ==========================================================================
  // String Operators (Case-Sensitive)
  // ==========================================================================

  describe("$contains", () => {
    it("should filter strings containing substring", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { email: { $contains: "@example" } },
      });

      expect(results.length).toBe(2);
      expect(results.every((u: any) => u.email?.includes("@example"))).toBe(true);
    });

    it("should be case-sensitive", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $contains: "alice" } },
      });

      expect(results.length).toBe(0); // "Alice" with capital A
    });
  });

  describe("$notContains", () => {
    it("should filter strings not containing substring", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { email: { $notContains: "@test" } },
      });

      // Alice, Charlie have @example, Eve has null
      expect(results.length).toBe(2);
    });
  });

  describe("$startsWith", () => {
    it("should filter strings starting with prefix", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $startsWith: "A" } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).name).toBe("Alice");
    });
  });

  describe("$endsWith", () => {
    it("should filter strings ending with suffix", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { email: { $endsWith: ".com" } },
      });

      expect(results.length).toBe(4);
    });
  });

  // ==========================================================================
  // String Operators (Case-Insensitive)
  // ==========================================================================

  describe("$containsi", () => {
    it("should filter strings containing substring (case-insensitive)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $containsi: "alice" } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).name).toBe("Alice");
    });

    it("should match regardless of case", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $containsi: "CHARLIE" } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).name).toBe("Charlie");
    });
  });

  describe("$notContainsi", () => {
    it("should filter strings not containing substring (case-insensitive)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $notContainsi: "a" } },
      });

      // Bob, Eve don't have 'a' or 'A'
      expect(results.length).toBe(2);
    });
  });

  describe("$startsWithi", () => {
    it("should filter strings starting with prefix (case-insensitive)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $startsWithi: "a" } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).name).toBe("Alice");
    });
  });

  describe("$endsWithi", () => {
    it("should filter strings ending with suffix (case-insensitive)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { name: { $endsWithi: "E" } },
      });

      // Alice, Charlie, Eve
      expect(results.length).toBe(3);
    });
  });

  // ==========================================================================
  // Existence Operators
  // ==========================================================================

  describe("$null", () => {
    it("should filter by null values ($null: true)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { email: { $null: true } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).name).toBe("Eve");
    });

    it("should filter by non-null values ($null: false)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { email: { $null: false } },
      });

      expect(results.length).toBe(4);
    });
  });

  describe("$empty", () => {
    it("should filter by empty arrays ($empty: true)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { tags: { $empty: true } },
      });

      expect(results.length).toBe(1);
      expect((results[0] as any).name).toBe("Charlie");
    });

    it("should filter by non-empty arrays ($empty: false)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { tags: { $empty: false } },
      });

      expect(results.length).toBe(4);
    });
  });

  describe("$notEmpty", () => {
    it("should filter by non-empty values ($notEmpty: true)", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { tags: { $notEmpty: true } },
      });

      expect(results.length).toBe(4);
    });
  });

  // ==========================================================================
  // Logical Operators
  // ==========================================================================

  describe("$and", () => {
    it("should combine conditions with AND", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {
          $and: [{ status: { $eq: "active" } }, { age: { $gte: 35 } }],
        },
      });

      expect(results.length).toBe(2); // Charlie (35), Eve (40)
    });

    it("should support nested conditions", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {
          $and: [{ status: "active" }, { email: { $contains: "@example" } }],
        },
      });

      expect(results.length).toBe(2); // Alice, Charlie
    });
  });

  describe("$or", () => {
    it("should combine conditions with OR", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {
          $or: [{ status: { $eq: "inactive" } }, { age: { $gte: 40 } }],
        },
      });

      expect(results.length).toBe(2); // Bob (inactive), Eve (40)
    });
  });

  describe("$not", () => {
    it("should negate condition", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {
          $not: { status: { $eq: "active" } },
        },
      });

      expect(results.length).toBe(2); // Bob, Diana
    });
  });

  // ==========================================================================
  // Complex / Combined Filters
  // ==========================================================================

  describe("Complex Filters", () => {
    it("should combine multiple field filters", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {
          status: "active",
          age: { $gte: 30 },
        },
      });

      expect(results.length).toBe(3); // Alice (30), Charlie (35), Eve (40)
    });

    it("should combine $and and $or", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {
          $and: [
            { status: "active" },
            {
              $or: [{ age: { $lt: 32 } }, { age: { $gte: 40 } }],
            },
          ],
        },
      });

      expect(results.length).toBe(2); // Alice (30), Eve (40)
    });

    it("should filter with nested field paths", async () => {
      // Seed data with nested objects
      await kv.set(["products", 1], { name: "Laptop", details: { price: 1000, stock: 5 } });
      await kv.set(["products", 2], { name: "Phone", details: { price: 500, stock: 10 } });
      await kv.set(["products", 3], { name: "Tablet", details: { price: 750, stock: 0 } });

      const results = await collectList(["products"], {
        where: { "details.price": { $gte: 600 } },
      });

      expect(results.length).toBe(2); // Laptop, Tablet
    });

    it("should handle multiple operators on same field", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {
          age: { $gte: 25, $lte: 35 },
        },
      });

      expect(results.length).toBe(4);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle empty where filter", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: {},
      });

      expect(results.length).toBe(5);
    });

    it("should handle special characters in string filters", async () => {
      await kv.set(["special", 1], { text: "Hello % World" });
      await kv.set(["special", 2], { text: "Hello _ World" });
      await kv.set(["special", 3], { text: "Hello \\ World" });

      // % should be escaped in LIKE
      const percent = await collectList(["special"], {
        where: { text: { $contains: "%" } },
      });
      expect(percent.length).toBe(1);

      // _ should be escaped in LIKE
      const underscore = await collectList(["special"], {
        where: { text: { $contains: "_" } },
      });
      expect(underscore.length).toBe(1);
    });

    it("should return empty array when no matches", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { age: { $gt: 100 } },
      });

      expect(results.length).toBe(0);
    });

    it("should work with limit and where combined", async () => {
      await seedUsers();
      const results = await collectList(["users"], {
        where: { status: "active" },
        limit: 2,
      });

      expect(results.length).toBe(2);
    });
  });
});
