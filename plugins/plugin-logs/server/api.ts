import { errorToResponse } from "@buntime/shared/errors";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addLog,
  clearLogs,
  getAllLogs,
  getLogs,
  getSseInterval,
  getStats,
  type LogEntry,
  type LogLevel,
} from "./services";

export interface CreateLogsApiOptions {
  /**
   * Auth middleware applied to every admin route. Plugin.ts injects
   * `createApiKeyMiddleware` from `@buntime/shared/middleware/api-key`.
   * Tests can omit it to exercise handlers directly.
   */
  middleware?: MiddlewareHandler;
}

/**
 * Build the logs admin router (control plane: viewer / clear / sse / stats).
 * Mounted at `/<base>/admin/**`. Gated by the supplied middleware.
 */
export function createAdminApi(options: CreateLogsApiOptions = {}) {
  const app = new Hono().basePath("/admin");
  if (options.middleware) {
    app.use("*", options.middleware);
  }
  return app
    .get("/", (ctx) => {
      const level = ctx.req.query("level") as LogLevel | undefined;
      const search = ctx.req.query("search");
      const limit = Number.parseInt(ctx.req.query("limit") || "100", 10);

      return ctx.json({
        logs: getLogs({ level, limit, search }),
        stats: getStats(),
      });
    })
    .get("/stats", (ctx) => {
      return ctx.json(getStats());
    })
    .get("/sse", (ctx) => {
      const interval = getSseInterval();

      return streamSSE(ctx, async (stream) => {
        let lastLength = 0;

        while (true) {
          const currentLogs = getAllLogs();
          const logs = currentLogs.slice(lastLength);
          lastLength = currentLogs.length;

          await stream.writeSSE({ data: JSON.stringify({ logs, stats: getStats() }) });
          await stream.sleep(interval);
        }
      });
    })
    .post("/clear", (ctx) => {
      clearLogs();
      return ctx.json({ success: true });
    })
    .onError((err) => {
      console.error("[Logs] Error:", err);
      return errorToResponse(err);
    });
}

/**
 * Runtime data-plane router: HTTP ingestion endpoint. Lives under
 * `/<base>/api/ingest` so other workers/plugins can POST log entries
 * without using the JS service contract. No X-API-Key requirement here;
 * upstream gating (if any) is configured at the runtime/plugin layer.
 */
export const runtimeApi = new Hono()
  .basePath("/api")
  .post("/ingest", async (ctx) => {
    const body = await ctx.req.json<Omit<LogEntry, "timestamp">>();
    addLog(body);
    return ctx.json({ success: true });
  })
  .onError((err) => {
    console.error("[Logs] Error:", err);
    return errorToResponse(err);
  });

/**
 * Backward-compat default admin router (no auth middleware). Tests import
 * this directly.
 */
export const api = createAdminApi();

export type ApiType = ReturnType<typeof createAdminApi>;
export type RuntimeApiType = typeof runtimeApi;
