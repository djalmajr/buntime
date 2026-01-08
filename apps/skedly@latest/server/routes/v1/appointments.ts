import { Hono } from "hono";

export default new Hono()
  .get("/", (ctx) => {
    return ctx.json([]);
  })
  .post("/", (ctx) => {
    return ctx.json({ message: "Not implemented yet" }, 501);
  });
