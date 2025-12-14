import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addLog,
  clearLogs,
  getAllLogs,
  getLogs,
  getSseInterval,
  getStats,
  getSubscribers,
  type LogEntry,
  type LogLevel,
} from "./services";

export const api = new Hono()
  .basePath("/api")
  .get("/logs", (ctx) => {
    const level = ctx.req.query("level") as LogLevel | undefined;
    const search = ctx.req.query("search");
    const limit = Number.parseInt(ctx.req.query("limit") || "100", 10);

    return ctx.json({
      logs: getLogs({ level, limit, search }),
      stats: getStats(),
    });
  })
  .get("/logs/stats", (ctx) => {
    return ctx.json(getStats());
  })
  .get("/logs/sse", (ctx) => {
    return streamSSE(ctx, async (stream) => {
      const logs = getAllLogs();
      let lastLength = logs.length;
      const subscribers = getSubscribers();
      const sseInterval = getSseInterval();

      const notify = () => {
        // Will be checked in the loop
      };

      subscribers.add(notify);

      try {
        while (true) {
          const currentLogs = getAllLogs();
          if (currentLogs.length !== lastLength) {
            const newLogs = currentLogs.slice(lastLength);
            lastLength = currentLogs.length;
            await stream.writeSSE({
              data: JSON.stringify({ logs: newLogs, stats: getStats() }),
            });
          }
          await stream.sleep(sseInterval);
        }
      } finally {
        subscribers.delete(notify);
      }
    });
  })
  .post("/logs/clear", (ctx) => {
    clearLogs();
    return ctx.json({ success: true });
  })
  .post("/logs", async (ctx) => {
    const body = await ctx.req.json<Omit<LogEntry, "timestamp">>();
    addLog(body);
    return ctx.json({ success: true });
  });

export type ApiType = typeof api;
