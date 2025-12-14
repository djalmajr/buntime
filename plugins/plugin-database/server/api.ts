import type { PluginLogger } from "@buntime/shared/types";
import { Hono } from "hono";
import type { DatabaseServiceImpl } from "./service";
import type { AdapterType } from "./types";

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
  // List available adapters
  .get("/adapters", (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    return ctx.json({
      adapters: service.getAvailableTypes(),
      default: service.getDefaultType(),
    });
  })
  // List tenants (optional type query param)
  .get("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const type = ctx.req.query("type") as AdapterType | undefined;
    const tenants = await service.listTenants(type);
    return ctx.json({ tenants, type: type ?? service.getDefaultType() });
  })
  // Create tenant
  .post("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const body = await ctx.req.json<{ id?: string; type?: AdapterType }>();
    if (!body.id || typeof body.id !== "string") {
      return ctx.json({ error: "Missing or invalid tenant id" }, 400);
    }

    await service.createTenant(body.id, body.type);
    return ctx.json({ ok: true, id: body.id, type: body.type ?? service.getDefaultType() }, 201);
  })
  // Delete tenant
  .delete("/tenants/:id", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const id = ctx.req.param("id");
    const type = ctx.req.query("type") as AdapterType | undefined;
    await service.deleteTenant(id, type);
    return ctx.json({ ok: true });
  })
  // Health check (checks all adapters or specific one)
  .get("/health", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized", status: "unhealthy" }, 500);
    }

    const type = ctx.req.query("type") as AdapterType | undefined;

    try {
      if (type) {
        // Check specific adapter
        const adapter = service.getRootAdapter(type);
        await adapter.execute("SELECT 1");
        return ctx.json({ status: "healthy", type });
      }

      // Check all adapters
      const results: Record<string, string> = {};
      for (const adapterType of service.getAvailableTypes()) {
        try {
          const adapter = service.getRootAdapter(adapterType);
          await adapter.execute("SELECT 1");
          results[adapterType] = "healthy";
        } catch (error) {
          results[adapterType] = error instanceof Error ? error.message : "unhealthy";
        }
      }

      const allHealthy = Object.values(results).every((s) => s === "healthy");
      return ctx.json({ status: allHealthy ? "healthy" : "degraded", adapters: results });
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
