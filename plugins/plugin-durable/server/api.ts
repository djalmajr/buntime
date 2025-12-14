import { Hono } from "hono";
import { registry } from "./services";

/**
 * Durable Objects REST API
 *
 * Provides endpoints for managing durable objects
 */
export const api = new Hono()
  .get("/", async (ctx) => {
    const objects = await registry.listAll();
    return ctx.json(objects);
  })
  .get("/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const object = await registry.getInfo(id);
    if (!object) {
      return ctx.json({ error: "Object not found" }, 404);
    }
    return ctx.json(object);
  })
  .delete("/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const deleted = await registry.delete(id);
    if (!deleted) {
      return ctx.json({ error: "Object not found" }, 404);
    }
    return ctx.json({ success: true });
  });

export type DurableRoutesType = typeof api;
