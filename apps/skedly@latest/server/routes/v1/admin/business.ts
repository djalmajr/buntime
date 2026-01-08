import { Hono } from "hono";

export default new Hono().get("/", (ctx) => {
  return ctx.json({});
});
