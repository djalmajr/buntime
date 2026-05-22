import type { ApiKeyStore } from "@buntime/shared/api-keys";
import { createApiKeyMiddleware } from "@buntime/shared/middleware/api-key";
import type { BasePluginConfig, PluginContext, PluginImpl } from "@buntime/shared/types";
import { Hono } from "hono";
import { createAdminApi, runtimeApi } from "./server/api";
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
 * - React UI for viewing logs
 * - API endpoints for fetching and managing logs
 * - SSE for real-time log streaming
 */
export default function logsPlugin(pluginConfig: LogsConfig = {}): PluginImpl {
  configure({
    maxEntries: pluginConfig.maxEntries,
    sseInterval: pluginConfig.sseInterval,
  });

  // Forwarder: admin routes are built at onInit (when auth context is known).
  // Until then, an unprotected fallback exists so tests and early requests do
  // not 500. Runtime ingest endpoint is always available unprotected via the
  // standard plugin-authn pipeline. `.all("/admin/*", ...)` is the deep
  // catch-all (Hono v4 — `*` alone only matches a single segment).
  let adminRouter = createAdminApi();
  const routes = new Hono()
    .all("/admin/*", (c) => adminRouter.fetch(c.req.raw))
    .route("/", runtimeApi);

  return {
    routes, // SSE requires main thread (streaming doesn't work in workers)

    // Expose log service for other plugins to use
    provides: () => ({ addLog, clearLogs, getLogs, getStats }),

    onInit(ctx: PluginContext) {
      setLogger(ctx.logger);

      // Wire X-API-Key gate for /<base>/admin/** (viewer / stats / sse / clear).
      const store = ctx.auth?.store as ApiKeyStore | undefined;
      const rootKey = ctx.auth?.rootKey;
      const middleware = store || rootKey ? createApiKeyMiddleware({ rootKey, store }) : undefined;
      adminRouter = createAdminApi({ middleware });

      ctx.logger.info("Logs plugin initialized");
    },
  };
}

// Re-export types and functions for external use
export { addLog, type LogEntry, type LogLevel } from "./server/services";
