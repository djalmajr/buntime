import { afterEach, describe, expect, it } from "bun:test";
import type { PoolLike } from "./services";
import { formatPrometheus, getMetrics, getStats, setPool } from "./services";

// Mock pool implementation for testing
function createMockPool(overrides: Partial<PoolLike> = {}): PoolLike {
  return {
    getMetrics: () => ({
      activeWorkers: 5,
      avgResponseTimeMs: 42.5,
      hitRate: 85,
      totalRequests: 1000,
      uptimeMs: 3600000,
    }),
    getWorkerStats: () => ({
      "app-1.0.0": {
        avgResponseTimeMs: 35,
        requestCount: 500,
        status: "active",
      },
      "app-1.0.1": {
        avgResponseTimeMs: 50,
        requestCount: 500,
        status: "idle",
      },
    }),
    ...overrides,
  };
}

// Helper to reset pool state between tests
// Since the module uses module-level state, we need to reset it
function resetPool() {
  // Setting undefined as PoolLike to reset state
  // This is a workaround since there's no explicit reset function
  setPool(undefined as unknown as PoolLike);
}

describe("services", () => {
  afterEach(() => {
    resetPool();
  });

  describe("setPool and getStats", () => {
    it("should return pool data after setPool is called", () => {
      const mockPool = createMockPool();
      setPool(mockPool);

      const stats = getStats();

      expect(stats.pool).toBeDefined();
      expect(stats.workers).toBeDefined();
      expect(stats.pool.activeWorkers).toBe(5);
      expect(stats.pool.totalRequests).toBe(1000);
    });

    it("should return worker stats from pool", () => {
      const mockPool = createMockPool();
      setPool(mockPool);

      const stats = getStats();

      expect(stats.workers["app-1.0.0"]).toBeDefined();
      expect(stats.workers["app-1.0.1"]).toBeDefined();
      expect((stats.workers["app-1.0.0"] as Record<string, unknown>).status).toBe("active");
    });
  });

  describe("getStats", () => {
    it("should return empty objects when no pool is set", () => {
      resetPool();

      const stats = getStats();

      expect(stats.pool).toEqual({});
      expect(stats.workers).toEqual({});
    });

    it("should return pool metrics and worker stats", () => {
      const mockPool = createMockPool({
        getMetrics: () => ({
          customMetric: 123,
          memoryUsageMB: 256,
        }),
        getWorkerStats: () => ({
          worker1: { status: "running" },
        }),
      });
      setPool(mockPool);

      const stats = getStats();

      expect(stats.pool.customMetric).toBe(123);
      expect(stats.pool.memoryUsageMB).toBe(256);
      expect((stats.workers.worker1 as Record<string, unknown>).status).toBe("running");
    });
  });

  describe("getMetrics", () => {
    it("should return null when no pool is set", () => {
      resetPool();

      const metrics = getMetrics();

      expect(metrics).toBeNull();
    });

    it("should return metrics when pool is set", () => {
      const mockPool = createMockPool();
      setPool(mockPool);

      const metrics = getMetrics();

      expect(metrics).not.toBeNull();
      expect(metrics?.activeWorkers).toBe(5);
      expect(metrics?.avgResponseTimeMs).toBe(42.5);
      expect(metrics?.hitRate).toBe(85);
      expect(metrics?.totalRequests).toBe(1000);
      expect(metrics?.uptimeMs).toBe(3600000);
    });

    it("should return custom metrics from pool", () => {
      const mockPool = createMockPool({
        getMetrics: () => ({
          customField: "value",
          nestedData: { count: 10 },
        }),
      });
      setPool(mockPool);

      const metrics = getMetrics();

      expect(metrics?.customField).toBe("value");
      expect(metrics?.nestedData).toEqual({ count: 10 });
    });
  });

  describe("formatPrometheus", () => {
    it("should format numeric metrics to Prometheus format", () => {
      const metrics = {
        activeWorkers: 5,
        hitRate: 85,
        totalRequests: 1000,
      };

      const result = formatPrometheus(metrics);

      expect(result).toContain("# TYPE buntime_active_workers gauge");
      expect(result).toContain("buntime_active_workers 5");
      expect(result).toContain("# TYPE buntime_hit_rate gauge");
      expect(result).toContain("buntime_hit_rate 85");
      expect(result).toContain("# TYPE buntime_total_requests gauge");
      expect(result).toContain("buntime_total_requests 1000");
    });

    it("should convert camelCase to snake_case with buntime prefix", () => {
      const metrics = {
        avgResponseTimeMs: 42.5,
      };

      const result = formatPrometheus(metrics);

      expect(result).toContain("buntime_avg_response_time_ms");
      expect(result).toContain("42.5");
    });

    it("should skip non-numeric values", () => {
      const metrics = {
        numericValue: 5,
        status: "running",
        objectValue: { count: 3 },
      };

      const result = formatPrometheus(metrics);

      expect(result).toContain("buntime_numeric_value 5");
      expect(result).not.toContain("status");
      expect(result).not.toContain("object_value");
      expect(result).not.toContain("running");
    });

    it("should handle empty metrics object", () => {
      const metrics = {};

      const result = formatPrometheus(metrics);

      expect(result).toBe("");
    });

    it("should handle metrics with only non-numeric values", () => {
      const metrics = {
        name: "test",
        status: "active",
      };

      const result = formatPrometheus(metrics);

      expect(result).toBe("");
    });

    it("should format multiple metrics correctly", () => {
      const metrics = {
        evictions: 10,
        hits: 850,
        misses: 150,
      };

      const result = formatPrometheus(metrics);
      const lines = result.split("\n");

      // Each metric has 2 lines (TYPE and value)
      expect(lines.length).toBe(6);
      expect(lines.filter((l) => l.startsWith("# TYPE")).length).toBe(3);
      expect(lines.filter((l) => l.startsWith("buntime_")).length).toBe(3);
    });

    it("should handle zero values", () => {
      const metrics = {
        errorCount: 0,
        successCount: 100,
      };

      const result = formatPrometheus(metrics);

      expect(result).toContain("buntime_error_count 0");
      expect(result).toContain("buntime_success_count 100");
    });

    it("should handle negative values", () => {
      const metrics = {
        temperatureDelta: -5.5,
      };

      const result = formatPrometheus(metrics);

      expect(result).toContain("buntime_temperature_delta -5.5");
    });

    it("should handle large numbers", () => {
      const metrics = {
        totalBytes: 1_000_000_000,
      };

      const result = formatPrometheus(metrics);

      expect(result).toContain("buntime_total_bytes 1000000000");
    });
  });
});
