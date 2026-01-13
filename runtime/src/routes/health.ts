/**
 * Health API Routes (/api/health)
 *
 * Provides health check endpoint for:
 * - Liveness probes (Kubernetes, load balancers)
 * - CLI connection verification
 *
 * This API is always available in the runtime.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { VERSION } from "@/constants";
import { HealthSchema } from "@/libs/openapi";

/**
 * Create health routes
 */
export function createHealthRoutes() {
  return new Hono()
    .get(
      "/",
      describeRoute({
        description: "Returns the health status of the runtime",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: HealthSchema,
              },
            },
            description: "Runtime is healthy",
          },
        },
        summary: "Health check",
        tags: ["Health"],
      }),
      (ctx) => {
        return ctx.json({
          ok: true,
          status: "healthy",
          version: VERSION,
        });
      },
    )
    .get(
      "/ready",
      describeRoute({
        description: "Returns the readiness status of the runtime",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: HealthSchema,
              },
            },
            description: "Runtime is ready",
          },
        },
        summary: "Readiness check",
        tags: ["Health"],
      }),
      (ctx) => {
        return ctx.json({
          ok: true,
          status: "ready",
          version: VERSION,
        });
      },
    )
    .get(
      "/live",
      describeRoute({
        description: "Returns the liveness status of the runtime",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: HealthSchema,
              },
            },
            description: "Runtime is live",
          },
        },
        summary: "Liveness check",
        tags: ["Health"],
      }),
      (ctx) => {
        return ctx.json({
          ok: true,
          status: "live",
          version: VERSION,
        });
      },
    );
}

export type HealthRoutesType = ReturnType<typeof createHealthRoutes>;
