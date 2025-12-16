import { errorToResponse } from "@buntime/shared/errors";
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

export const api = new Hono()
  .basePath("/api")
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
  .post("/", async (ctx) => {
    const body = await ctx.req.json<Omit<LogEntry, "timestamp">>();
    addLog(body);
    return ctx.json({ success: true });
  })
  .onError((err) => {
    console.error("[Logs] Error:", err);
    return errorToResponse(err);
  });

export type ApiType = typeof api;
