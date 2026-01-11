import type { BasePluginConfig, PluginContext, PluginImpl } from "@buntime/shared/types";
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
export default function logsPlugin(pluginConfig: LogsConfig = {}): PluginImpl {
  configure({
    maxEntries: pluginConfig.maxEntries,
    sseInterval: pluginConfig.sseInterval,
  });

  return {
    routes: api, // SSE requires main thread (streaming doesn't work in workers)

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
