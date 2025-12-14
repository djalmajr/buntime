import { Hono } from "hono";
import { runHealthChecks } from "./services";

export const api = new Hono()
  .basePath("/api")
  .get("/health", async (ctx) => {
    const report = await runHealthChecks();
    return ctx.json(report);
  })
  .get("/health/live", (ctx) => {
    // Liveness probe - always returns 200 if server is running
    return ctx.json({ status: "live" });
  })
  .get("/health/ready", async (ctx) => {
    // Readiness probe - returns 200 only if all checks pass
    const report = await runHealthChecks();
    const status = report.status === "healthy" ? 200 : 503;
    return ctx.json(report, status);
  });

export type ApiType = typeof api;
