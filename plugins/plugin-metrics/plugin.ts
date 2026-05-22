import type { ApiKeyStore } from "@buntime/shared/api-keys";
import { createApiKeyMiddleware } from "@buntime/shared/middleware/api-key";
import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import { Hono } from "hono";
import { createAdminApi, runtimeApi, setConfig } from "./server/api";
import type { PoolLike } from "./server/services";
import { setPool } from "./server/services";

export interface MetricsConfig {
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

/**
 * Metrics plugin for Buntime
 *
 * Provides endpoints:
 * - GET /<base>/admin/         - JSON metrics            (X-API-Key)
 * - GET /<base>/admin/sse      - Server-Sent Events      (X-API-Key)
 * - GET /<base>/admin/stats    - Full stats (pool + workers) (X-API-Key)
 * - GET /<base>/prometheus     - Prometheus scrape       (open, network-gated)
 */
export default function metricsPlugin(pluginConfig: MetricsConfig = {}): PluginImpl {
  // Forwarder for admin routes — populated at onInit when ctx.auth lands.
  // `.all("/admin/*", ...)` is correct: deep catch-all under /admin only,
  // leaving /prometheus to the runtimeApi route below.
  let adminRouter = createAdminApi();
  const routes = new Hono()
    .all("/admin/*", (c) => adminRouter.fetch(c.req.raw))
    .route("/", runtimeApi);

  return {
    routes,

    onInit(ctx: PluginContext) {
      setPool(ctx.pool as PoolLike);
      setConfig({ sseInterval: pluginConfig.sseInterval });

      const store = ctx.auth?.store as ApiKeyStore | undefined;
      const rootKey = ctx.auth?.rootKey;
      const middleware = store || rootKey ? createApiKeyMiddleware({ rootKey, store }) : undefined;
      adminRouter = createAdminApi({ middleware });

      ctx.logger.info("Metrics plugin initialized");
    },
  };
}

// Also export as named for convenience
export { metricsPlugin };

// Export type for API client
export type { MetricsRoutesType } from "./server/api";
