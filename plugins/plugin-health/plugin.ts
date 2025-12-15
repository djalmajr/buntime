import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import {
  configure,
  registerHealthCheck,
  runHealthChecks,
  setLogger,
  setPool,
  unregisterHealthCheck,
} from "./server/services";

export interface HealthConfig extends BasePluginConfig {
  /**
   * Health check timeout in milliseconds
   * @default 5000
   */
  timeout?: number;
}

/**
 * Health plugin for Buntime
 *
 * Provides:
 * - System health checks (pool, memory)
 * - Custom health check registration
 * - React UI for viewing health status (fragment)
 * - Kubernetes-compatible probes (/live, /ready)
 */
export default function healthPlugin(pluginConfig: HealthConfig = {}): BuntimePlugin {
  configure({ timeout: pluginConfig.timeout });

  return {
    name: "@buntime/plugin-health",

    // Fragment with monkey-patch sandbox (internal plugin)
    fragment: {
      type: "monkey-patch",
    },

    // Menu items for C-Panel sidebar
    menus: [
      {
        icon: "lucide:heart-pulse",
        path: "/health",
        priority: 30,
        title: "Health",
      },
    ],

    onInit(ctx: PluginContext) {
      setLogger(ctx.logger);
      if (ctx.pool) {
        setPool(ctx.pool as { getMetrics(): Record<string, unknown> });
      }
      ctx.logger.info("Health plugin initialized");

      // Register health service for other plugins
      ctx.registerService("health", {
        registerHealthCheck,
        runHealthChecks,
        unregisterHealthCheck,
      });
    },
  };
}

// Re-export types and functions for external use
export {
  type HealthCheck,
  type HealthReport,
  type HealthStatus,
  registerHealthCheck,
  unregisterHealthCheck,
} from "./server/services";
