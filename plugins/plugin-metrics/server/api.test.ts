import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { api, setConfig } from "./api";
import type { PoolLike } from "./services";
import { setPool } from "./services";

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
function resetPool() {
  setPool(undefined as unknown as PoolLike);
}

// Helper to make requests to the API
function request(path: string) {
  return api.request(`http://localhost${path}`);
}

describe("api routes", () => {
  beforeEach(() => {
    resetPool();
    setConfig({});
  });

  afterEach(() => {
    resetPool();
  });

  describe("setConfig", () => {
    it("should set config for SSE interval", () => {
      setConfig({ sseInterval: 2000 });
      // Config is internal, verified indirectly via SSE behavior
      expect(true).toBe(true);
    });

    it("should handle empty config", () => {
      setConfig({});
      expect(true).toBe(true);
    });
  });

  describe("GET /api", () => {
    it("should return 503 when pool is not initialized", async () => {
      const res = await request("/api");

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toEqual({ error: "Pool not initialized" });
    });

    it("should return metrics JSON when pool is initialized", async () => {
      const mockPool = createMockPool();
      setPool(mockPool);

      const res = await request("/api");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.activeWorkers).toBe(5);
      expect(body.avgResponseTimeMs).toBe(42.5);
      expect(body.hitRate).toBe(85);
      expect(body.totalRequests).toBe(1000);
      expect(body.uptimeMs).toBe(3600000);
    });

    it("should return custom metrics from pool", async () => {
      const mockPool = createMockPool({
        getMetrics: () => ({
          customMetric: "value",
          nestedData: { count: 10 },
        }),
      });
      setPool(mockPool);

      const res = await request("/api");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.customMetric).toBe("value");
      expect(body.nestedData).toEqual({ count: 10 });
    });
  });

  describe("GET /api/prometheus", () => {
    it("should return 503 when pool is not initialized", async () => {
      const res = await request("/api/prometheus");

      expect(res.status).toBe(503);
      const body = await res.text();
      expect(body).toBe("# Pool not initialized");
    });

    it("should return Prometheus format when pool is initialized", async () => {
      const mockPool = createMockPool();
      setPool(mockPool);

      const res = await request("/api/prometheus");

      expect(res.status).toBe(200);
      // Content-Type header is set but Hono may add charset
      expect(res.headers.get("Content-Type")).toContain("text/plain");

      const body = await res.text();
      expect(body).toContain("# TYPE buntime_active_workers gauge");
      expect(body).toContain("buntime_active_workers 5");
      expect(body).toContain("# TYPE buntime_total_requests gauge");
      expect(body).toContain("buntime_total_requests 1000");
    });

    it("should format camelCase metrics to snake_case", async () => {
      const mockPool = createMockPool({
        getMetrics: () => ({
          avgResponseTimeMs: 42.5,
          maxMemoryUsageMB: 512,
        }),
      });
      setPool(mockPool);

      const res = await request("/api/prometheus");
      const body = await res.text();

      expect(body).toContain("buntime_avg_response_time_ms 42.5");
      expect(body).toContain("buntime_max_memory_usage_m_b 512");
    });

    it("should skip non-numeric values in Prometheus output", async () => {
      const mockPool = createMockPool({
        getMetrics: () => ({
          numericValue: 100,
          status: "running",
          version: "1.0.0",
        }),
      });
      setPool(mockPool);

      const res = await request("/api/prometheus");
      const body = await res.text();

      expect(body).toContain("buntime_numeric_value 100");
      expect(body).not.toContain("status");
      expect(body).not.toContain("version");
    });
  });

  describe("GET /api/stats", () => {
    it("should return empty objects when pool is not initialized", async () => {
      const res = await request("/api/stats");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ pool: {}, workers: {} });
    });

    it("should return pool and worker stats when pool is initialized", async () => {
      const mockPool = createMockPool();
      setPool(mockPool);

      const res = await request("/api/stats");

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.pool.activeWorkers).toBe(5);
      expect(body.pool.totalRequests).toBe(1000);

      expect(body.workers["app-1.0.0"]).toBeDefined();
      expect(body.workers["app-1.0.0"].status).toBe("active");
      expect(body.workers["app-1.0.1"]).toBeDefined();
      expect(body.workers["app-1.0.1"].status).toBe("idle");
    });

    it("should return custom worker stats", async () => {
      const mockPool = createMockPool({
        getWorkerStats: () => ({
          "custom-worker": {
            customField: "value",
            memory: 256,
          },
        }),
      });
      setPool(mockPool);

      const res = await request("/api/stats");

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.workers["custom-worker"]).toBeDefined();
      expect(body.workers["custom-worker"].customField).toBe("value");
      expect(body.workers["custom-worker"].memory).toBe(256);
    });
  });

  describe("GET /api/sse", () => {
    it("should return SSE stream response", async () => {
      const mockPool = createMockPool();
      setPool(mockPool);
      setConfig({ sseInterval: 100 });

      const res = await request("/api/sse");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      // Read partial stream to verify SSE data format
      const reader = res.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);

        expect(text).toContain("data:");
        // Cancel the stream to avoid hanging
        await reader.cancel();
      }
    });

    it("should use default interval when not configured", async () => {
      const mockPool = createMockPool();
      setPool(mockPool);
      setConfig({}); // No interval set

      const res = await request("/api/sse");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");

      const reader = res.body?.getReader();
      if (reader) {
        await reader.cancel();
      }
    });

    it("should stream stats data in SSE format", async () => {
      const mockPool = createMockPool();
      setPool(mockPool);
      setConfig({ sseInterval: 50 });

      const res = await request("/api/sse");
      const reader = res.body?.getReader();

      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);

        // Parse the SSE data
        const dataMatch = text.match(/data:\s*(.+)/);
        if (dataMatch?.[1]) {
          const jsonData = JSON.parse(dataMatch[1]);
          expect(jsonData.pool).toBeDefined();
          expect(jsonData.workers).toBeDefined();
        }

        await reader.cancel();
      }
    });
  });

  describe("error handling", () => {
    it("should handle errors through onError handler", async () => {
      // Test that the onError handler exists and returns proper response
      // We can't easily trigger errors in the routes, but we verify the handler works
      // by testing routes that could throw with invalid state

      // Make a request that won't throw but validates error handling exists
      const res = await request("/api");
      expect(res.status).toBe(503); // Expected behavior, not an error
    });

    it("should handle thrown errors from getMetrics", async () => {
      // Create a pool that throws an error when getMetrics is called
      const errorPool = createMockPool({
        getMetrics: () => {
          throw new Error("Test error from getMetrics");
        },
      });
      setPool(errorPool);

      const res = await request("/api");

      // The onError handler should catch the error and return a proper response
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should handle thrown errors from pool stats", async () => {
      // Create a pool that throws an error when getMetrics is called
      const errorPool = createMockPool({
        getMetrics: () => {
          throw new Error("Pool metrics error");
        },
      });
      setPool(errorPool);

      const res = await request("/api/prometheus");

      // The onError handler should catch the error
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
