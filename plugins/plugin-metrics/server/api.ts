import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { formatPrometheus, getMetrics, getStats } from "./services";

export interface MetricsConfig {
  /**
   * SSE update interval in milliseconds
   * @default 1000
   */
  sseInterval?: number;
}

let config: MetricsConfig = {};

export function setConfig(cfg: MetricsConfig) {
  config = cfg;
}

export const api = new Hono()
  .basePath("/api")
  .get("/", (ctx) => {
    const metrics = getMetrics();
    if (!metrics) {
      return ctx.json({ error: "Pool not initialized" }, 503);
    }
    return ctx.json(metrics);
  })
  .get("/prometheus", (ctx) => {
    const metrics = getMetrics();
    if (!metrics) {
      return ctx.text("# Pool not initialized", 503);
    }

    ctx.header("Content-Type", "text/plain; version=0.0.4");
    return ctx.text(formatPrometheus(metrics));
  })
  .get("/sse", (ctx) => {
    const interval = config.sseInterval ?? 1000;

    return streamSSE(ctx, async (stream) => {
      while (true) {
        await stream.writeSSE({ data: JSON.stringify(getStats()) });
        await stream.sleep(interval);
      }
    });
  })
  .get("/stats", (ctx) => {
    return ctx.json(getStats());
  });

export type MetricsRoutesType = typeof api;
