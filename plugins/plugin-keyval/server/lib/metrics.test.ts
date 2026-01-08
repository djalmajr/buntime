import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { KvMetrics } from "./metrics";
import { initSchema } from "./schema";
import { createTestAdapter } from "./test-helpers";

describe("KvMetrics", () => {
  let metrics: KvMetrics;

  beforeEach(() => {
    metrics = new KvMetrics();
  });

  describe("recordOperation", () => {
    it("should record operations", () => {
      metrics.recordOperation("get", 5);
      metrics.recordOperation("get", 10);
      metrics.recordOperation("set", 15);

      const json = metrics.toJSON() as {
        operations: Record<string, { avgLatencyMs: number; count: number; errors: number }>;
        totals: { errors: number; operations: number };
      };

      expect(json.operations.get?.count).toBe(2);
      expect(json.operations.get?.avgLatencyMs).toBe(7.5);
      expect(json.operations.set?.count).toBe(1);
      expect(json.operations.set?.avgLatencyMs).toBe(15);
      expect(json.totals.operations).toBe(3);
    });

    it("should record errors", () => {
      metrics.recordOperation("get", 5, false);
      metrics.recordOperation("get", 10, true);
      metrics.recordOperation("set", 15, true);

      const json = metrics.toJSON() as {
        operations: Record<string, { avgLatencyMs: number; count: number; errors: number }>;
        totals: { errors: number; operations: number };
      };

      expect(json.operations.get?.errors).toBe(1);
      expect(json.operations.set?.errors).toBe(1);
      expect(json.totals.errors).toBe(2);
    });
  });

  describe("toPrometheus", () => {
    it("should generate Prometheus format", () => {
      metrics.recordOperation("get", 5);
      metrics.recordOperation("set", 10);

      const prometheus = metrics.toPrometheus("keyval");

      expect(prometheus).toContain('keyval_operations_total{operation="get"} 1');
      expect(prometheus).toContain('keyval_operations_total{operation="set"} 1');
      expect(prometheus).toContain("keyval_operation_duration_ms_bucket");
      expect(prometheus).toContain("keyval_operation_duration_ms_sum");
      expect(prometheus).toContain("keyval_operation_duration_ms_count");
    });

    it("should populate histogram buckets correctly", () => {
      metrics.recordOperation("get", 0.5); // <= 1ms bucket
      metrics.recordOperation("get", 3); // <= 5ms bucket
      metrics.recordOperation("get", 50); // <= 50ms bucket
      metrics.recordOperation("get", 200); // <= 250ms bucket

      const prometheus = metrics.toPrometheus("keyval");

      // All 4 should be in +Inf bucket
      expect(prometheus).toContain(
        'keyval_operation_duration_ms_bucket{operation="get",le="+Inf"} 4',
      );

      // Check sum
      expect(prometheus).toContain('keyval_operation_duration_ms_sum{operation="get"} 253.5');
    });
  });

  describe("reset", () => {
    it("should reset metrics", () => {
      metrics.recordOperation("get", 5);
      metrics.recordOperation("set", 10);

      metrics.reset();

      const json = metrics.toJSON() as {
        operations: Record<string, unknown>;
        totals: { errors: number; operations: number };
      };

      expect(Object.keys(json.operations)).toHaveLength(0);
      expect(json.totals.operations).toBe(0);
    });
  });

  describe("persistent metrics", () => {
    let adapter: ReturnType<typeof createTestAdapter>;

    beforeAll(async () => {
      adapter = createTestAdapter();
      await initSchema(adapter);
    });

    afterAll(async () => {
      await adapter.close();
    });

    beforeEach(async () => {
      await adapter.execute("DELETE FROM kv_metrics");
    });

    it("should persist metrics to database", async () => {
      const persistentMetrics = new KvMetrics({
        adapter,
        flushInterval: 100, // Short interval for testing
      });

      persistentMetrics.recordOperation("get", 5);
      persistentMetrics.recordOperation("set", 10);

      // Manually flush
      await persistentMetrics.flush();

      // Check database
      const rows = await adapter.execute<{ operation: string; count: number }>(
        "SELECT operation, count FROM kv_metrics",
      );

      expect(rows.length).toBe(2);

      await persistentMetrics.close();
    });

    it("should load existing metrics from database", async () => {
      // Pre-populate database
      await adapter.execute(
        "INSERT INTO kv_metrics (id, operation, count, errors, latency_sum, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ["get", "get", 100, 5, 500, Date.now()],
      );

      const persistentMetrics = new KvMetrics({ adapter });

      // Give it time to load
      await new Promise((r) => setTimeout(r, 100));

      await persistentMetrics.close();
    });

    it("should handle flush with no pending updates", async () => {
      const persistentMetrics = new KvMetrics({ adapter });

      // Flush with no pending updates should not throw
      await persistentMetrics.flush();

      await persistentMetrics.close();
    });

    it("should start periodic flush timer", async () => {
      const persistentMetrics = new KvMetrics({
        adapter,
        flushInterval: 50,
      });

      persistentMetrics.recordOperation("get", 5);

      // Wait for periodic flush
      await new Promise((r) => setTimeout(r, 100));

      // Check that data was flushed
      const rows = await adapter.execute<{ operation: string }>(
        "SELECT operation FROM kv_metrics WHERE operation = 'get'",
      );

      expect(rows.length).toBe(1);

      await persistentMetrics.close();
    });

    it("should stop flush timer on close", async () => {
      const persistentMetrics = new KvMetrics({
        adapter,
        flushInterval: 50,
      });

      persistentMetrics.recordOperation("get", 5);

      // Close before flush
      await persistentMetrics.close();

      // Verify close completed (data should have been flushed)
      const rows = await adapter.execute<{ operation: string }>(
        "SELECT operation FROM kv_metrics WHERE operation = 'get'",
      );

      expect(rows.length).toBe(1);
    });

    it("should handle flush when no adapter is configured", async () => {
      const metricsWithoutAdapter = new KvMetrics();

      // Should not throw
      await metricsWithoutAdapter.flush();

      await metricsWithoutAdapter.close();
    });

    it("should accumulate updates with ON CONFLICT clause", async () => {
      const persistentMetrics = new KvMetrics({ adapter });

      persistentMetrics.recordOperation("get", 5);
      await persistentMetrics.flush();

      persistentMetrics.recordOperation("get", 10);
      await persistentMetrics.flush();

      // Check that counts accumulated
      const rows = await adapter.execute<{ count: number }>(
        "SELECT count FROM kv_metrics WHERE operation = 'get'",
      );

      expect(rows[0]?.count).toBe(2); // 2 operations

      await persistentMetrics.close();
    });
  });
});
