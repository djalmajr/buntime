import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { LibSqlAdapter } from "@buntime/plugin-database";
import { Kv } from "../src/kv";
import { KvMetrics } from "../src/metrics";
import { initSchema } from "../src/schema";

describe("KvMetrics integration", () => {
  describe("integrated with Kv", () => {
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

    beforeEach(() => {
      kv.metrics.reset();
    });

    it("should record get operations", async () => {
      await kv.get(["test", "key"]);

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.get?.count).toBe(1);
    });

    it("should record set operations", async () => {
      await kv.set(["test", "key"], { value: 1 });

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.set?.count).toBe(1);
    });

    it("should record delete operations", async () => {
      await kv.set(["test", "to-delete"], { value: 1 });
      kv.metrics.reset();

      await kv.delete(["test", "to-delete"]);

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.delete?.count).toBe(1);
    });

    it("should record list operations", async () => {
      await kv.set(["list", "1"], { v: 1 });
      await kv.set(["list", "2"], { v: 2 });
      kv.metrics.reset();

      const entries = [];
      for await (const entry of kv.list({ prefix: ["list"] })) {
        entries.push(entry);
      }

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.list?.count).toBe(1);
      expect(entries.length).toBe(2);
    });

    it("should record getMany operations", async () => {
      await kv.set(["many", "1"], { v: 1 });
      await kv.set(["many", "2"], { v: 2 });
      kv.metrics.reset();

      await kv.getMany([
        ["many", "1"],
        ["many", "2"],
      ]);

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.getMany?.count).toBe(1);
    });

    it("should record atomic_commit operations", async () => {
      await kv.atomic().set(["atomic", "key"], { value: 1 }).commit();

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.atomic_commit?.count).toBe(1);
    });

    it("should record queue operations", async () => {
      await kv.queue.enqueue({ msg: "test" });
      const msg = await kv.queue.dequeue();
      if (msg) {
        await kv.queue.ack(msg.id);
      }

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.queue_enqueue?.count).toBe(1);
      expect(json.operations.queue_dequeue?.count).toBe(1);
      expect(json.operations.queue_ack?.count).toBe(1);
    });

    it("should record queue nack operations", async () => {
      await kv.queue.enqueue({ msg: "nack-test" }, { backoffSchedule: [10] });
      const msg = await kv.queue.dequeue();
      if (msg) {
        await kv.queue.nack(msg.id);
      }

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.queue_nack?.count).toBe(1);
    });

    it("should accumulate metrics across operations", async () => {
      await kv.set(["accum", "1"], { v: 1 });
      await kv.set(["accum", "2"], { v: 2 });
      await kv.get(["accum", "1"]);
      await kv.get(["accum", "2"]);
      await kv.get(["accum", "3"]);

      const json = kv.metrics.toJSON() as {
        operations: Record<string, { count: number }>;
        totals: { operations: number };
      };

      expect(json.operations.set?.count).toBe(2);
      expect(json.operations.get?.count).toBe(3);
      expect(json.totals.operations).toBe(5);
    });
  });

  describe("persistent metrics", () => {
    let adapter: LibSqlAdapter;
    let metrics: KvMetrics;

    beforeAll(async () => {
      adapter = new LibSqlAdapter({ type: "libsql", url: ":memory:" });
      await initSchema(adapter);
    });

    afterAll(async () => {
      await metrics?.close();
      await adapter.close();
    });

    it("should create metrics with persistence", () => {
      metrics = new KvMetrics({
        adapter,
        flushInterval: 100,
      });

      expect(metrics).toBeDefined();
    });

    it("should record operations with persistence enabled", () => {
      metrics.recordOperation("get", 5);
      metrics.recordOperation("set", 10);

      const json = metrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };

      expect(json.operations.get?.count).toBe(1);
      expect(json.operations.set?.count).toBe(1);
    });

    it("should flush metrics to database", async () => {
      metrics.recordOperation("get", 15);

      // Manually flush
      await metrics.flush();

      // Check database has metrics
      const rows = await adapter.execute<{ operation: string; count: number }>(
        "SELECT operation, count FROM kv_metrics WHERE operation = ?",
        ["get"],
      );

      expect(rows.length).toBe(1);
      expect(rows[0]?.count).toBeGreaterThan(0);
    });

    it("should accumulate metrics on flush", async () => {
      // Record more operations
      metrics.recordOperation("get", 5);
      metrics.recordOperation("get", 10);
      await metrics.flush();

      const rows = await adapter.execute<{ operation: string; count: number }>(
        "SELECT operation, count FROM kv_metrics WHERE operation = ?",
        ["get"],
      );

      // Should have accumulated the previous flushes
      expect(rows[0]?.count).toBeGreaterThan(2);
    });

    it("should close and flush pending metrics", async () => {
      const closeMetrics = new KvMetrics({
        adapter,
        flushInterval: 60000, // Long interval
      });

      closeMetrics.recordOperation("delete", 5);

      // Close should flush pending
      await closeMetrics.close();

      const rows = await adapter.execute<{ operation: string; count: number }>(
        "SELECT operation, count FROM kv_metrics WHERE operation = ?",
        ["delete"],
      );

      expect(rows.length).toBe(1);
    });

    it("should run periodic flush automatically", async () => {
      const periodicMetrics = new KvMetrics({
        adapter,
        flushInterval: 100, // Short interval
      });

      periodicMetrics.recordOperation("periodic_test", 10);

      // Wait for automatic flush
      await new Promise((r) => setTimeout(r, 200));

      const rows = await adapter.execute<{ operation: string; count: number }>(
        "SELECT operation, count FROM kv_metrics WHERE operation = ?",
        ["periodic_test"],
      );

      expect(rows.length).toBe(1);
      expect(rows[0]?.count).toBeGreaterThan(0);

      await periodicMetrics.close();
    });

    it("should handle flush errors silently", async () => {
      // Create metrics with an adapter that will fail
      const errorAdapter = new LibSqlAdapter({ type: "libsql", url: ":memory:" });
      await initSchema(errorAdapter);

      const errorMetrics = new KvMetrics({
        adapter: errorAdapter,
        flushInterval: 50,
      });

      errorMetrics.recordOperation("error_test", 5);

      // Drop the metrics table to cause flush errors
      await errorAdapter.execute("DROP TABLE kv_metrics");

      // Wait for flush to fail (should not throw)
      await new Promise((r) => setTimeout(r, 100));

      // Metrics should still work locally
      const json = errorMetrics.toJSON() as {
        operations: Record<string, { count: number }>;
      };
      expect(json.operations.error_test?.count).toBe(1);

      // Recreate table before closing to avoid close() flush error
      await errorAdapter.execute(`
        CREATE TABLE kv_metrics (
          id TEXT PRIMARY KEY,
          operation TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          errors INTEGER NOT NULL DEFAULT 0,
          latency_sum REAL NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )
      `);

      await errorMetrics.close();
      await errorAdapter.close();
    });
  });
});
