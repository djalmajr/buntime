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
    it("should return correct plugin name", () => {
      const plugin = metricsPlugin();
      expect(plugin.name).toBe("@buntime/plugin-metrics");
    });

    it("should return routes", () => {
      const plugin = metricsPlugin();
      expect(plugin.routes).toBeDefined();
    });

    it("should return menus array", () => {
      const plugin = metricsPlugin();
      expect(plugin.menus).toBeDefined();
      expect(Array.isArray(plugin.menus)).toBe(true);
      expect(plugin.menus?.length).toBeGreaterThan(0);
    });

    it("should return onInit function", () => {
      const plugin = metricsPlugin();
      expect(plugin.onInit).toBeDefined();
      expect(typeof plugin.onInit).toBe("function");
    });

    it("should return fragment configuration", () => {
      const plugin = metricsPlugin();
      expect(plugin.fragment).toBeDefined();
      expect(plugin.fragment?.type).toBe("patch");
    });
  });

  describe("base path", () => {
    it("should use default base '/metrics' when no config provided", () => {
      const plugin = metricsPlugin();
      expect(plugin.base).toBe("/metrics");
    });

    it("should use default base '/metrics' when empty config provided", () => {
      const plugin = metricsPlugin({});
      expect(plugin.base).toBe("/metrics");
    });

    it("should use custom base from config", () => {
      const config: MetricsConfig = { base: "/custom-metrics" };
      const plugin = metricsPlugin(config);
      expect(plugin.base).toBe("/custom-metrics");
    });

    it("should handle base path with different formats", () => {
      const plugin1 = metricsPlugin({ base: "/stats" });
      expect(plugin1.base).toBe("/stats");

      const plugin2 = metricsPlugin({ base: "/api/metrics" });
      expect(plugin2.base).toBe("/api/metrics");
    });
  });

  describe("menus configuration", () => {
    it("should have correct menu structure", () => {
      const plugin = metricsPlugin();
      const menu = plugin.menus?.[0];

      expect(menu).toBeDefined();
      expect(menu?.icon).toBe("lucide:activity");
      expect(menu?.path).toBe("/metrics");
      expect(menu?.title).toBe("Metrics");
      expect(menu?.priority).toBe(5);
    });

    it("should have menu items", () => {
      const plugin = metricsPlugin();
      const menu = plugin.menus?.[0];

      expect(menu?.items).toBeDefined();
      expect(Array.isArray(menu?.items)).toBe(true);
      expect(menu?.items?.length).toBeGreaterThanOrEqual(2);
    });

    it("should have Overview menu item", () => {
      const plugin = metricsPlugin();
      const menu = plugin.menus?.[0];
      const overviewItem = menu?.items?.find((item) => item.title === "Overview");

      expect(overviewItem).toBeDefined();
      expect(overviewItem?.icon).toBe("lucide:layout-dashboard");
      expect(overviewItem?.path).toBe("/metrics");
    });

    it("should have Workers menu item", () => {
      const plugin = metricsPlugin();
      const menu = plugin.menus?.[0];
      const workersItem = menu?.items?.find((item) => item.title === "Workers");

      expect(workersItem).toBeDefined();
      expect(workersItem?.icon).toBe("lucide:cpu");
      expect(workersItem?.path).toBe("/metrics/workers");
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
      expect(plugin.base).toBe("/my-metrics");
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
