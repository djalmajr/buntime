import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { WorkerState } from "@/constants";
import { WorkerMetrics } from "./metrics";

describe("WorkerMetrics", () => {
  let metrics: WorkerMetrics;

  beforeEach(() => {
    metrics = new WorkerMetrics();
  });

  afterEach(() => {
    metrics.reset();
  });

  describe("getStats", () => {
    it("should return initial stats", () => {
      const stats = metrics.getStats(0);
      expect(stats.activeWorkers).toBe(0);
      expect(stats.avgResponseTimeMs).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      // requestsPerSecond may be 0 or NaN depending on timing
      expect(stats.requestsPerSecond >= 0 || Number.isNaN(stats.requestsPerSecond)).toBe(true);
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalWorkersFailed).toBe(0);
      expect(stats.totalWorkersCreated).toBe(0);
      expect(stats.totalWorkersRetired).toBe(0);
      expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof stats.memoryUsageMB).toBe("number");
    });

    it("should return correct active workers count", () => {
      const stats = metrics.getStats(5);
      expect(stats.activeWorkers).toBe(5);
    });
  });

  describe("recordRequest", () => {
    it("should increment total requests", () => {
      metrics.recordRequest(100);
      metrics.recordRequest(200);
      const stats = metrics.getStats(0);
      expect(stats.totalRequests).toBe(2);
    });

    it("should calculate average response time", () => {
      metrics.recordRequest(100);
      metrics.recordRequest(200);
      metrics.recordRequest(300);
      const stats = metrics.getStats(0);
      expect(stats.avgResponseTimeMs).toBe(200);
    });

    it("should use circular buffer for response times", () => {
      // Fill buffer beyond capacity (100 entries)
      for (let i = 0; i < 150; i++) {
        metrics.recordRequest(10);
      }
      const stats = metrics.getStats(0);
      expect(stats.totalRequests).toBe(150);
      expect(stats.avgResponseTimeMs).toBe(10);
    });
  });

  describe("cache hit/miss tracking", () => {
    it("should track hits", () => {
      metrics.recordHit();
      metrics.recordHit();
      const stats = metrics.getStats(0);
      expect(stats.hits).toBe(2);
    });

    it("should track misses", () => {
      metrics.recordMiss();
      metrics.recordMiss();
      metrics.recordMiss();
      const stats = metrics.getStats(0);
      expect(stats.misses).toBe(3);
    });

    it("should calculate hit rate correctly", () => {
      metrics.recordHit();
      metrics.recordHit();
      metrics.recordHit();
      metrics.recordMiss();
      const stats = metrics.getStats(0);
      expect(stats.hitRate).toBe(75);
    });

    it("should return 0 hit rate when no requests", () => {
      const stats = metrics.getStats(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe("evictions", () => {
    it("should track evictions", () => {
      metrics.recordEviction();
      metrics.recordEviction();
      const stats = metrics.getStats(0);
      expect(stats.evictions).toBe(2);
    });
  });

  describe("worker lifecycle tracking", () => {
    it("should track workers created", () => {
      metrics.recordWorkerCreated();
      metrics.recordWorkerCreated();
      const stats = metrics.getStats(0);
      expect(stats.totalWorkersCreated).toBe(2);
    });

    it("should track workers failed", () => {
      metrics.recordWorkerFailed();
      const stats = metrics.getStats(0);
      expect(stats.totalWorkersFailed).toBe(1);
    });
  });

  describe("accumulateWorkerStats", () => {
    it("should accumulate stats for new worker", () => {
      metrics.accumulateWorkerStats("app-1.0.0", {
        avgResponseTimeMs: 50,
        errorCount: 2,
        requestCount: 10,
        totalResponseTimeMs: 500,
      });

      const historical = metrics.getHistoricalStats();
      expect(historical["app-1.0.0"]).toBeDefined();
      expect(historical["app-1.0.0"]?.requestCount).toBe(10);
      expect(historical["app-1.0.0"]?.errorCount).toBe(2);
    });

    it("should accumulate stats for existing worker", () => {
      metrics.accumulateWorkerStats("app-1.0.0", {
        avgResponseTimeMs: 50,
        errorCount: 2,
        requestCount: 10,
        totalResponseTimeMs: 500,
      });

      metrics.accumulateWorkerStats("app-1.0.0", {
        avgResponseTimeMs: 100,
        errorCount: 3,
        requestCount: 20,
        totalResponseTimeMs: 2000,
      });

      const historical = metrics.getHistoricalStats();
      expect(historical["app-1.0.0"]?.requestCount).toBe(30);
      expect(historical["app-1.0.0"]?.errorCount).toBe(5);
      expect(historical["app-1.0.0"]?.totalResponseTimeMs).toBe(2500);
    });

    it("should increment totalWorkersRetired", () => {
      metrics.accumulateWorkerStats("app-1.0.0", {
        avgResponseTimeMs: 50,
        errorCount: 0,
        requestCount: 10,
        totalResponseTimeMs: 500,
      });
      const stats = metrics.getStats(0);
      expect(stats.totalWorkersRetired).toBe(1);
    });
  });

  describe("ephemeral workers", () => {
    it("should record ephemeral worker for document request", () => {
      metrics.recordEphemeralWorker("app-1.0.0", 100, true, false);
      const ephemeral = metrics.getEphemeralWorkers();
      expect(ephemeral["app-1.0.0"]).toBeDefined();
      expect(ephemeral["app-1.0.0"]?.status).toBe(WorkerState.EPHEMERAL);
      expect(ephemeral["app-1.0.0"]?.requestCount).toBe(1);
    });

    it("should accumulate stats for same session", () => {
      metrics.recordEphemeralWorker("app-1.0.0", 100, true, false); // Document
      metrics.recordEphemeralWorker("app-1.0.0", 50, false, false); // Asset
      metrics.recordEphemeralWorker("app-1.0.0", 30, false, false); // Asset

      const ephemeral = metrics.getEphemeralWorkers();
      expect(ephemeral["app-1.0.0"]?.requestCount).toBe(3);
      expect(ephemeral["app-1.0.0"]?.lastRequestCount).toBe(3);
    });

    it("should reset last metrics on new document request", () => {
      metrics.recordEphemeralWorker("app-1.0.0", 100, true, false);
      metrics.recordEphemeralWorker("app-1.0.0", 50, false, false);
      metrics.recordEphemeralWorker("app-1.0.0", 200, true, false); // New session

      const ephemeral = metrics.getEphemeralWorkers();
      expect(ephemeral["app-1.0.0"]?.requestCount).toBe(3);
      expect(ephemeral["app-1.0.0"]?.lastRequestCount).toBe(1);
    });

    it("should reset last metrics on API request", () => {
      metrics.recordEphemeralWorker("app-1.0.0", 100, true, false);
      metrics.recordEphemeralWorker("app-1.0.0", 50, false, true); // API request

      const ephemeral = metrics.getEphemeralWorkers();
      expect(ephemeral["app-1.0.0"]?.lastRequestCount).toBe(1);
    });
  });

  describe("getHistoricalStats", () => {
    it("should return empty object initially", () => {
      const historical = metrics.getHistoricalStats();
      expect(Object.keys(historical).length).toBe(0);
    });

    it("should return accumulated stats", () => {
      metrics.accumulateWorkerStats("app-1", {
        avgResponseTimeMs: 50,
        errorCount: 1,
        requestCount: 10,
        totalResponseTimeMs: 500,
      });
      metrics.accumulateWorkerStats("app-2", {
        avgResponseTimeMs: 100,
        errorCount: 2,
        requestCount: 20,
        totalResponseTimeMs: 2000,
      });

      const historical = metrics.getHistoricalStats();
      expect(Object.keys(historical).length).toBe(2);
      expect(historical["app-1"]).toBeDefined();
      expect(historical["app-2"]).toBeDefined();
    });
  });

  describe("reset", () => {
    it("should reset all metrics", () => {
      metrics.recordRequest(100);
      metrics.recordHit();
      metrics.recordMiss();
      metrics.recordEviction();
      metrics.recordWorkerCreated();
      metrics.recordWorkerFailed();
      metrics.accumulateWorkerStats("app-1", {
        avgResponseTimeMs: 50,
        errorCount: 1,
        requestCount: 10,
        totalResponseTimeMs: 500,
      });
      metrics.recordEphemeralWorker("app-2", 100, true, false);

      metrics.reset();

      const stats = metrics.getStats(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.totalWorkersCreated).toBe(0);
      expect(stats.totalWorkersFailed).toBe(0);
      expect(stats.totalWorkersRetired).toBe(0);
      expect(Object.keys(metrics.getHistoricalStats()).length).toBe(0);
      expect(Object.keys(metrics.getEphemeralWorkers()).length).toBe(0);
    });
  });
});
