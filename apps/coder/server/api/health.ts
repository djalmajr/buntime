import { Hono } from "hono";
import { NODE_ENV, VERSION } from "@/constants";

const app = new Hono().get("/", (c) => {
  return c.json({
    env: NODE_ENV,
    ok: true,
    timestamp: Date.now(),
    version: VERSION,
  });
});

export default app;
