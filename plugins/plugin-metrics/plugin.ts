import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { api, setConfig } from "./server/api";
import type { PoolLike } from "./server/services";
import { setPool } from "./server/services";

export interface MetricsConfig extends BasePluginConfig {
  /**
   * Enable Prometheus format endpoint
   * @default true
   */
  prometheus?: boolean;

  /**
   * SSE update interval in milliseconds
   * @default 1000
   */
  sseInterval?: number;
}

/**
 * Metrics plugin for Buntime
 *
 * Provides endpoints:
 * - GET /api/metrics/ - JSON metrics
 * - GET /api/metrics/prometheus - Prometheus format
 * - GET /api/metrics/sse - Server-Sent Events stream
 * - GET /api/metrics/stats - Full stats (pool + workers)
 */
export default function metricsPlugin(pluginConfig: MetricsConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-metrics",
    base: pluginConfig.base ?? "/metrics",
    routes: api,

    fragment: {
      type: "patch",
    },

    menus: [
      {
        icon: "lucide:activity",
        items: [
          { icon: "lucide:layout-dashboard", path: "/metrics", title: "Overview" },
          // { icon: "lucide:flame", path: "/metrics/prometheus", title: "Prometheus" },
          { icon: "lucide:cpu", path: "/metrics/workers", title: "Workers" },
        ],
        path: "/metrics",
        priority: 5,
        title: "Metrics",
      },
    ],

    onInit(ctx: PluginContext) {
      setPool(ctx.pool as PoolLike);
      setConfig({ sseInterval: pluginConfig.sseInterval });
      ctx.logger.info("Metrics plugin initialized");
    },
  };
}

// Also export as named for convenience
export { metricsPlugin };

// Export type for API client
export type { MetricsRoutesType } from "./server/api";
