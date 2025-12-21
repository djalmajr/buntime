import projects from "@/routes/projects";
import { Hono } from "hono";
import { cors } from "hono/cors";

const api = new Hono()
  .route("/projects", projects)
  .post("/cache/clear", (ctx) => {
    return ctx.json({ message: "No cache (reading from disk)", ok: true });
  });

const app = new Hono()
  .use("*", cors())
  .route("/api", api);

export type ApiType = typeof api;

export { app };
