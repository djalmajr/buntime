import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import type { ResponseCache } from "./cache";
import type { GatewayConfig } from "./types";

/**
 * Create gateway API routes
 */
export function createGatewayApi(
  config: () => GatewayConfig,
  rateLimiter: () => { enabled: boolean } | null,
  responseCache: () => ResponseCache | null,
) {
  return new Hono()
    .basePath("/api")
    .get("/stats", (ctx) => {
      return ctx.json({
        cache: responseCache()?.getStats() ?? null,
        rateLimit: rateLimiter() ? { enabled: true } : null,
        cors: config().cors ? { enabled: true } : null,
      });
    })
    .post("/cache/invalidate", async (ctx) => {
      const body = await ctx.req.json<{ pattern?: string; key?: string }>();

      const cache = responseCache();
      if (!cache) {
        return ctx.json({ error: "Cache not enabled" }, 400);
      }

      if (body.key) {
        const deleted = cache.invalidate(body.key);
        return ctx.json({ invalidated: deleted ? 1 : 0 });
      }

      if (body.pattern) {
        const count = cache.invalidatePattern(new RegExp(body.pattern));
        return ctx.json({ invalidated: count });
      }

      cache.clear();
      return ctx.json({ invalidated: "all" });
    })
    .onError((err) => {
      console.error("[Gateway] API Error:", err);
      return errorToResponse(err);
    });
}

export type GatewayRoutesType = ReturnType<typeof createGatewayApi>;
