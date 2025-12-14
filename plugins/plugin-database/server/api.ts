import type { PluginLogger } from "@buntime/shared/types";
import { Hono } from "hono";
import type { DatabaseServiceImpl } from "./service";

let service: DatabaseServiceImpl | null = null;
let logger: PluginLogger;

export function setService(svc: DatabaseServiceImpl, log: PluginLogger) {
  service = svc;
  logger = log;
}

export const api = new Hono()
  .basePath("/api")
  .onError((err, ctx) => {
    logger?.error("Database plugin error", { error: err.message });
    return ctx.json({ error: err.message }, 500);
  })
  // List tenants
  .get("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const tenants = await service.listTenants();
    return ctx.json({ tenants });
  })
  // Create tenant
  .post("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const body = await ctx.req.json<{ id?: string }>();
    if (!body.id || typeof body.id !== "string") {
      return ctx.json({ error: "Missing or invalid tenant id" }, 400);
    }

    await service.createTenant(body.id);
    return ctx.json({ ok: true, id: body.id }, 201);
  })
  // Delete tenant
  .delete("/tenants/:id", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const id = ctx.req.param("id");
    await service.deleteTenant(id);
    return ctx.json({ ok: true });
  })
  // Health check
  .get("/health", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized", status: "unhealthy" }, 500);
    }

    try {
      // Try a simple query to check connection
      const adapter = service.getRootAdapter();
      await adapter.execute("SELECT 1");
      return ctx.json({ status: "healthy" });
    } catch (error) {
      return ctx.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          status: "unhealthy",
        },
        500,
      );
    }
  });
