import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export interface MetricsConfig extends BasePluginConfig {
  /**
   * Enable Prometheus format endpoint
   * @default true
   */
  prometheus?: boolean;

  /**
   * SSE update interval in milliseconds
   * @default 1000
   */
  sseInterval?: number;
}

interface PoolLike {
  getMetrics(): Record<string, unknown>;
  getWorkerStats(): Record<string, unknown>[];
}

let pool: PoolLike | undefined;
let config: MetricsConfig = {};

function getStats() {
  if (!pool) {
    return { pool: {}, workers: [] };
  }

  return {
    pool: pool.getMetrics(),
    workers: pool.getWorkerStats(),
  };
}

function formatPrometheus(metrics: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number") {
      const name = `buntime_${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }
  }

  return lines.join("\n");
}

const routes = new Hono()
  .get("/", (ctx) => {
    if (!pool) {
      return ctx.json({ error: "Pool not initialized" }, 503);
    }
    return ctx.json(pool.getMetrics());
  })
  .get("/prometheus", (ctx) => {
    if (!pool) {
      return ctx.text("# Pool not initialized", 503);
    }

    const metrics = pool.getMetrics() as Record<string, unknown>;
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

/**
 * Metrics plugin for Buntime
 *
 * Provides endpoints:
 * - GET /_/metrics/ - JSON metrics
 * - GET /_/metrics/prometheus - Prometheus format
 * - GET /_/metrics/sse - Server-Sent Events stream
 * - GET /_/metrics/stats - Full stats (pool + workers)
 */
export default function metricsPlugin(pluginConfig: MetricsConfig = {}): BuntimePlugin {
  config = pluginConfig;

  return {
    name: "@buntime/plugin-metrics",
    mountPath: pluginConfig.mountPath,
    priority: 0, // Run first
    version: "1.0.0",

    onInit(ctx: PluginContext) {
      pool = ctx.pool as PoolLike;
      ctx.logger.info("Metrics plugin initialized");
    },

    routes,
  };
}

// Also export as named for convenience
export { metricsPlugin };
