import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { api } from "./server/api";
import { addLog, clearLogs, configure, getLogs, getStats, setLogger } from "./server/services";

export interface LogsConfig extends BasePluginConfig {
  /**
   * Maximum number of log entries to keep in memory
   * @default 1000
   */
  maxEntries?: number;

  /**
   * SSE update interval in milliseconds
   * @default 1000
   */
  sseInterval?: number;
}

/**
 * Logs plugin for Buntime
 *
 * Provides:
 * - In-memory log collection
 * - React UI for viewing logs (fragment)
 * - API endpoints for fetching and managing logs
 * - SSE for real-time log streaming
 */
export default function logsPlugin(pluginConfig: LogsConfig = {}): BuntimePlugin {
  configure({
    maxEntries: pluginConfig.maxEntries,
    sseInterval: pluginConfig.sseInterval,
  });

  return {
    name: "@buntime/plugin-logs",
    routes: api, // SSE requires main thread (streaming doesn't work in workers)

    // Fragment with patch sandbox (internal plugin)
    fragment: {
      type: "patch",
    },

    // Menu items for C-Panel sidebar
    menus: [
      {
        icon: "lucide:scroll-text",
        path: "/logs",
        priority: 40,
        title: "Logs",
      },
    ],

    onInit(ctx: PluginContext) {
      setLogger(ctx.logger);
      ctx.logger.info("Logs plugin initialized");

      // Register log service for other plugins to use
      ctx.registerService("logs", { addLog, clearLogs, getLogs, getStats });
    },
  };
}

// Re-export types and functions for external use
export { addLog, type LogEntry, type LogLevel } from "./server/services";
