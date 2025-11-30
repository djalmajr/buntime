import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { pool } from "@/libs/pool";
import deployments from "./deployments";

function getStats() {
  return {
    pool: pool.getMetrics(),
    workers: pool.getWorkerStats(),
  };
}

export default new Hono()
  .route("/deployments", deployments)
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
