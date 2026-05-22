import { errorToResponse } from "@buntime/shared/errors";
import type { MiddlewareHandler } from "hono";
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

export interface CreateMetricsApiOptions {
  /**
   * Auth middleware applied to admin routes. Plugin.ts injects
   * `createApiKeyMiddleware` from `@buntime/shared/middleware/api-key`.
   */
  middleware?: MiddlewareHandler;
}

/**
 * Build the metrics admin router (`/<base>/admin/**`).
 *
 * - `/admin/`, `/admin/sse`, `/admin/stats` are operator surfaces gated by
 *   the runtime X-API-Key.
 * - `/prometheus` is intentionally NOT here — it's a runtime data-plane
 *   route consumed by external scrapers (see `runtimeApi`).
 */
export function createAdminApi(options: CreateMetricsApiOptions = {}) {
  const app = new Hono().basePath("/admin");
  if (options.middleware) {
    app.use("*", options.middleware);
  }
  return app
    .get("/", (ctx) => {
      const metrics = getMetrics();
      if (!metrics) {
        return ctx.json({ error: "Pool not initialized" }, 503);
      }
      return ctx.json(metrics);
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
    })
    .onError((err) => {
      console.error("[Metrics] Error:", err);
      return errorToResponse(err);
    });
}

/**
 * Runtime data-plane router. Exposes the Prometheus scrape endpoint at
 * `/<base>/prometheus`. Kept open (manifest publicRoutes) so external
 * monitoring tools can scrape without an API key — secure via network
 * boundary (firewall / VPC) instead.
 */
export const runtimeApi = new Hono().get("/prometheus", (ctx) => {
  const metrics = getMetrics();
  if (!metrics) {
    return ctx.text("# Pool not initialized", 503);
  }

  ctx.header("Content-Type", "text/plain; version=0.0.4");
  return ctx.text(formatPrometheus(metrics));
});

/**
 * Backward-compat default admin router (no auth middleware). Tests import
 * this directly.
 */
export const api = createAdminApi();

export type MetricsRoutesType = ReturnType<typeof createAdminApi>;
export type RuntimeApiType = typeof runtimeApi;
