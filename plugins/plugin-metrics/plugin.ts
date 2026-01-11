import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import { api, setConfig } from "./server/api";
import type { PoolLike } from "./server/services";
import { setPool } from "./server/services";

export interface MetricsConfig {
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
export default function metricsPlugin(pluginConfig: MetricsConfig = {}): PluginImpl {
  return {
    routes: api,

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
