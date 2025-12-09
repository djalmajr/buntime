import { Hono as HonoApp } from "hono";
import { streamSSE } from "hono/streaming";
import type { WorkerPool } from "@/libs/pool/pool";
import type { DeploymentRoutesType } from "@/routes/internal/deployments";

export interface InternalRoutesDeps {
  deployments: DeploymentRoutesType;
  pool: WorkerPool;
}

export function createInternalRoutes({ deployments, pool }: InternalRoutesDeps) {
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
  return (
    new HonoApp()
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
      })
  );
}

export type InternalRoutesType = ReturnType<typeof createInternalRoutes>;
