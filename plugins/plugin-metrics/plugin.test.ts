import { afterEach, describe, expect, it, mock } from "bun:test";
import type { PluginContext } from "@buntime/shared/types";
import metricsPlugin, { type MetricsConfig } from "./plugin";
import type { PoolLike } from "./server/services";
import { getMetrics, getStats, setPool } from "./server/services";

// Helper to reset pool state between tests
function resetPool() {
  setPool(undefined as unknown as PoolLike);
}

// Create a mock pool for testing onInit
function createMockPool(): PoolLike {
  return {
    getMetrics: () => ({
      activeWorkers: 3,
      totalRequests: 100,
    }),
    getWorkerStats: () => ({
      "test-1.0.0": { status: "active" },
    }),
  };
}

// Create a mock plugin context for testing onInit
function createMockContext(pool: PoolLike): PluginContext {
  return {
    logger: {
      child: mock(() => ({}) as ReturnType<PluginContext["logger"]["child"]>),
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    },
    pool,
  } as unknown as PluginContext;
}

describe("metricsPlugin", () => {
  describe("plugin structure", () => {
    it("should return a valid plugin object with implementation properties", () => {
      const plugin = metricsPlugin();
      expect(plugin.routes).toBeDefined();
      expect(plugin.onInit).toBeDefined();
      expect(typeof plugin.onInit).toBe("function");
    });
  });

  describe("config options", () => {
    it("should accept prometheus config option", () => {
      const config: MetricsConfig = { prometheus: true };
      const plugin = metricsPlugin(config);
      expect(plugin).toBeDefined();
    });

    it("should accept sseInterval config option", () => {
      const config: MetricsConfig = { sseInterval: 2000 };
      const plugin = metricsPlugin(config);
      expect(plugin).toBeDefined();
    });

    it("should accept combined config options", () => {
      const config: MetricsConfig = {
        base: "/my-metrics",
        prometheus: false,
        sseInterval: 5000,
      };
      const plugin = metricsPlugin(config);
      expect(plugin.routes).toBeDefined();
    });
  });

  describe("onInit", () => {
    afterEach(() => {
      resetPool();
    });

    it("should set pool from context", () => {
      const plugin = metricsPlugin();
      const mockPool = createMockPool();
      const ctx = createMockContext(mockPool);

      // Pool should be unset initially
      expect(getMetrics()).toBeNull();

      // Call onInit
      plugin.onInit?.(ctx);

      // Pool should now be set
      const metrics = getMetrics();
      expect(metrics).not.toBeNull();
      expect(metrics?.activeWorkers).toBe(3);
      expect(metrics?.totalRequests).toBe(100);
    });

    it("should log initialization message", () => {
      const plugin = metricsPlugin();
      const mockPool = createMockPool();
      const ctx = createMockContext(mockPool);

      plugin.onInit?.(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith("Metrics plugin initialized");
    });

    it("should set config with sseInterval", () => {
      const plugin = metricsPlugin({ sseInterval: 2000 });
      const mockPool = createMockPool();
      const ctx = createMockContext(mockPool);

      plugin.onInit?.(ctx);

      // Verify pool was set correctly
      const stats = getStats();
      expect(stats.pool).toBeDefined();
      expect(stats.workers).toBeDefined();
    });

    it("should work with default sseInterval when not provided", () => {
      const plugin = metricsPlugin();
      const mockPool = createMockPool();
      const ctx = createMockContext(mockPool);

      plugin.onInit?.(ctx);

      // Verify pool was set correctly
      const stats = getStats();
      expect(stats.pool.activeWorkers).toBe(3);
    });
  });
});
