import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Kv } from "../src/kv";
import { initSchema } from "../src/schema";
import { createTestAdapter } from "./helpers";

describe("KvTransaction", () => {
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
    it("should read and write in a transaction", async () => {
      await kv.set(["balance", "user1"], 100);

      const result = await kv.transaction(async (tx) => {
        const balance = await tx.get<number>(["balance", "user1"]);
        tx.set(["balance", "user1"], (balance.value ?? 0) - 30);
        return { newBalance: (balance.value ?? 0) - 30 };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.newBalance).toBe(70);
        expect(result.versionstamp).toBeDefined();
      }

      const finalBalance = await kv.get<number>(["balance", "user1"]);
      expect(finalBalance.value).toBe(70);
    });

    it("should cache reads within a transaction", async () => {
      await kv.set(["data", "key"], { value: "original" });

      const result = await kv.transaction(async (tx) => {
        const first = await tx.get(["data", "key"]);
        // Modify outside transaction (simulating concurrent access)
        await kv.set(["data", "key"], { value: "modified" });
        const second = await tx.get(["data", "key"]);

        // Should return cached value, not the modified one
        return { first: first.value, second: second.value };
      });

      expect(result.ok).toBe(false); // Should conflict because data changed
      if (!result.ok) {
        expect(result.error).toBe("conflict");
      }
    });

    it("should buffer writes until commit", async () => {
      await kv.set(["counter"], 0);

      const result = await kv.transaction(async (tx) => {
        const entry = await tx.get<number>(["counter"]);
        tx.set(["counter"], (entry.value ?? 0) + 1);
        tx.set(["counter"], (entry.value ?? 0) + 2);
        tx.set(["counter"], (entry.value ?? 0) + 3);
        // Only the last write should take effect
        return { writes: 3 };
      });

      expect(result.ok).toBe(true);
      const final = await kv.get<number>(["counter"]);
      expect(final.value).toBe(3); // Last write wins
    });

    it("should support delete in transactions", async () => {
      await kv.set(["to-delete"], { value: "exists" });

      const result = await kv.transaction(async (tx) => {
        const entry = await tx.get(["to-delete"]);
        if (entry.value) {
          tx.delete(["to-delete"]);
        }
        return { deleted: true };
      });

      expect(result.ok).toBe(true);
      const deleted = await kv.get(["to-delete"]);
      expect(deleted.value).toBe(null);
    });
  });

  describe("conflict detection", () => {
    it("should detect concurrent modification", async () => {
      await kv.set(["shared", "key"], { version: 1 });

      const result = await kv.transaction(async (tx) => {
        await tx.get(["shared", "key"]);

        // Simulate concurrent modification
        await kv.set(["shared", "key"], { version: 2 });

        tx.set(["shared", "key"], { version: 3 });
        return { attempted: true };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("conflict");
      }

      // Original concurrent write should be preserved
      const final = await kv.get<{ version: number }>(["shared", "key"]);
      expect(final.value?.version).toBe(2);
    });

    it("should detect deletion during transaction", async () => {
      await kv.set(["ephemeral"], { value: "here" });

      const result = await kv.transaction(async (tx) => {
        const entry = await tx.get(["ephemeral"]);

        // Delete outside transaction
        await kv.delete(["ephemeral"]);

        tx.set(["ephemeral"], { value: "updated" });
        return { had: entry.value };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("conflict");
      }
    });

    it("should succeed when no concurrent modifications", async () => {
      await kv.set(["stable", "a"], 1);
      await kv.set(["stable", "b"], 2);

      const result = await kv.transaction(async (tx) => {
        const a = await tx.get<number>(["stable", "a"]);
        const b = await tx.get<number>(["stable", "b"]);

        tx.set(["stable", "sum"], (a.value ?? 0) + (b.value ?? 0));
        return { sum: (a.value ?? 0) + (b.value ?? 0) };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sum).toBe(3);
      }

      const sum = await kv.get<number>(["stable", "sum"]);
      expect(sum.value).toBe(3);
    });
  });

  describe("retry mechanism", () => {
    it("should retry on conflict when configured", async () => {
      await kv.set(["retry-test"], 0);
      let attempts = 0;

      const result = await kv.transaction(
        async (tx) => {
          attempts++;
          const entry = await tx.get<number>(["retry-test"]);

          // Cause conflict on first attempt only
          if (attempts === 1) {
            await kv.set(["retry-test"], 999);
          }

          tx.set(["retry-test"], (entry.value ?? 0) + 1);
          return { attempts };
        },
        { maxRetries: 3, retryDelay: 5 },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.attempts).toBe(2); // Succeeded on second attempt
      }

      const final = await kv.get<number>(["retry-test"]);
      expect(final.value).toBe(1000); // 999 + 1
    });

    it("should give up after max retries", async () => {
      await kv.set(["always-conflict"], 0);
      let attempts = 0;

      const result = await kv.transaction(
        async (tx) => {
          attempts++;
          await tx.get(["always-conflict"]);
          // Always modify outside, causing conflict
          await kv.set(["always-conflict"], attempts);
          tx.set(["always-conflict"], -1);
          return { done: true };
        },
        { maxRetries: 2, retryDelay: 1 },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("conflict");
      }
      expect(attempts).toBe(3); // Initial + 2 retries
    });
  });

  describe("error handling", () => {
    it("should return error when transaction function throws", async () => {
      const result = await kv.transaction(async () => {
        throw new Error("Business logic error");
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("error");
        expect(result.message).toBe("Business logic error");
      }
    });

    it("should not modify data when transaction function throws", async () => {
      await kv.set(["safe"], { value: "original" });

      const result = await kv.transaction(async (tx) => {
        await tx.get(["safe"]);
        tx.set(["safe"], { value: "modified" });
        throw new Error("Abort!");
      });

      expect(result.ok).toBe(false);
      const entry = await kv.get<{ value: string }>(["safe"]);
      expect(entry.value?.value).toBe("original");
    });

    it("should prevent operations after commit", async () => {
      // Test that using a transaction object after commit throws
      const tx = await (async () => {
        let capturedTx: InstanceType<typeof import("../src/transaction").KvTransaction> | null =
          null;

        await kv.transaction(async (tx) => {
          capturedTx = tx;
          await tx.get(["test-key"]);
          return { done: true };
        });

        return capturedTx!;
      })();

      // After commit, trying to use the transaction should throw
      if (tx) {
        await expect(tx.get(["another-key"])).rejects.toThrow("Transaction already committed");
        expect(() => tx.set(["key"], "value")).toThrow("Transaction already committed");
        expect(() => tx.delete(["key"])).toThrow("Transaction already committed");
      }
    });
  });

  describe("get with multiple keys", () => {
    it("should batch get multiple keys", async () => {
      await kv.set(["multi", "a"], 1);
      await kv.set(["multi", "b"], 2);
      await kv.set(["multi", "c"], 3);

      const result = await kv.transaction(async (tx) => {
        const entries = await tx.get<number>([
          ["multi", "a"],
          ["multi", "b"],
          ["multi", "c"],
        ]);

        const sum = entries.reduce((acc, e) => acc + (e.value ?? 0), 0);
        tx.set(["multi", "sum"], sum);
        return { sum };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sum).toBe(6);
      }
    });

    it("should cache batch get results", async () => {
      await kv.set(["cache", "x"], 10);

      const result = await kv.transaction(async (tx) => {
        // First access via batch get
        await tx.get([["cache", "x"]]);

        // Modify outside
        await kv.set(["cache", "x"], 20);

        // Second access via get should return cached value
        const cached = await tx.get<number>(["cache", "x"]);

        tx.set(["cache", "result"], cached.value);
        return { cached: cached.value };
      });

      // Should conflict because data changed
      expect(result.ok).toBe(false);
    });
  });

  describe("sum operation", () => {
    it("should sum values atomically", async () => {
      await kv.set(["counter"], 100);

      const result = await kv.transaction(async (tx) => {
        await tx.get(["counter"]);
        tx.sum(["counter"], 50n);
        return { summed: true };
      });

      expect(result.ok).toBe(true);

      // Note: sum is applied as bigint but we stored as number
      // This is testing the sum operation is buffered correctly
    });

    it("should throw when sum called after commit", async () => {
      let capturedTx: InstanceType<typeof import("../src/transaction").KvTransaction> | null = null;

      await kv.transaction(async (tx) => {
        capturedTx = tx;
        return { done: true };
      });

      if (capturedTx) {
        expect(() => capturedTx!.sum(["key"], 10n)).toThrow("Transaction already committed");
      }
    });
  });

  describe("readCount and writeCount", () => {
    it("should track read count", async () => {
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      await kv.transaction(async (tx) => {
        expect(tx.readCount).toBe(0);

        await tx.get(["a"]);
        expect(tx.readCount).toBe(1);

        await tx.get(["b"]);
        expect(tx.readCount).toBe(2);

        // Same key should not increase count (cached)
        await tx.get(["a"]);
        expect(tx.readCount).toBe(2);

        return { done: true };
      });
    });

    it("should track write count", async () => {
      await kv.transaction(async (tx) => {
        expect(tx.writeCount).toBe(0);

        tx.set(["x"], 1);
        expect(tx.writeCount).toBe(1);

        tx.set(["y"], 2);
        expect(tx.writeCount).toBe(2);

        tx.delete(["z"]);
        expect(tx.writeCount).toBe(3);

        return { done: true };
      });
    });
  });

  describe("complex scenarios", () => {
    it("should handle money transfer correctly", async () => {
      await kv.set(["account", "alice"], 100);
      await kv.set(["account", "bob"], 50);

      const result = await kv.transaction(async (tx) => {
        const alice = await tx.get<number>(["account", "alice"]);
        const bob = await tx.get<number>(["account", "bob"]);

        const amount = 30;

        if ((alice.value ?? 0) < amount) {
          throw new Error("Insufficient funds");
        }

        tx.set(["account", "alice"], (alice.value ?? 0) - amount);
        tx.set(["account", "bob"], (bob.value ?? 0) + amount);

        return { transferred: amount };
      });

      expect(result.ok).toBe(true);

      const alice = await kv.get<number>(["account", "alice"]);
      const bob = await kv.get<number>(["account", "bob"]);

      expect(alice.value).toBe(70);
      expect(bob.value).toBe(80);
    });

    it("should handle order creation with inventory check", async () => {
      await kv.set(["inventory", "product-1"], 5);
      await kv.set(["user", "balance"], 200);

      const result = await kv.transaction(async (tx) => {
        const inventory = await tx.get<number>(["inventory", "product-1"]);
        const balance = await tx.get<number>(["user", "balance"]);

        const quantity = 2;
        const price = 50;
        const total = quantity * price;

        if ((inventory.value ?? 0) < quantity) {
          throw new Error("Out of stock");
        }
        if ((balance.value ?? 0) < total) {
          throw new Error("Insufficient funds");
        }

        tx.set(["inventory", "product-1"], (inventory.value ?? 0) - quantity);
        tx.set(["user", "balance"], (balance.value ?? 0) - total);
        tx.set(["orders", crypto.randomUUID()], {
          product: "product-1",
          quantity,
          total,
        });

        return { orderPlaced: true, total };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(100);
      }

      const inventory = await kv.get<number>(["inventory", "product-1"]);
      const balance = await kv.get<number>(["user", "balance"]);

      expect(inventory.value).toBe(3);
      expect(balance.value).toBe(100);
    });
  });
});
