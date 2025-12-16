import { beforeEach, describe, expect, it } from "bun:test";
import { KvMetrics } from "./metrics";

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
});
