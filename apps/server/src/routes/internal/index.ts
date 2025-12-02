import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { pool } from "~/libs/pool/pool";
import deployments from "./deployments";

function getStats() {
  return {
    pool: pool.getMetrics(),
    workers: pool.getWorkerStats(),
  };
}

/**
 * Internal routes (/_/*)
 *
 * Note: metrics, stats, and sse routes are now handled by the metrics plugin.
 * They remain here as fallback for when the plugin is not loaded.
 */
export default new Hono()
  .route("/deployments", deployments)
  // Fallback metrics routes (if metrics plugin is not loaded)
  .get("/metrics", (ctx) => {
    return ctx.json(pool.getMetrics());
  })
  .get("/sse", (ctx) => {
    return streamSSE(ctx, async (stream) => {
      while (true) {
        await stream.writeSSE({ data: JSON.stringify(getStats()) });
        await stream.sleep(1000);
      }
    });
  })
  .get("/stats", (ctx) => {
    return ctx.json(getStats());
  });
