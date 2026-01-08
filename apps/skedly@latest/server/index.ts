import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { CfEnv } from "./lib/auth";
import auth from "./routes/auth";
import v1 from "./routes/v1";

const app = new Hono<CfEnv>()
  .basePath("/api")
  .use((ctx, next) => {
    // Use process.env for Buntime workers (ctx.env is for Cloudflare Workers)
    const allowedOrigins = ctx.env?.ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? "*";
    const origins = allowedOrigins.split(",");
    return cors({ credentials: true, origin: origins })(ctx, next);
  })
  .get("/health", (ctx) => ctx.json({ health: "ok" }, 200))
  .post("/echo", async (ctx) => {
    const body = await ctx.req.json();
    return ctx.json({ received: body }, 200);
  })
  .route("/auth", auth)
  .route("/v1", v1)
  .onError((err) => {
    if (err instanceof HTTPException) {
      return new Response(JSON.stringify({ error: err.cause, message: err.message }), {
        status: err.getResponse().status,
      });
    }

    console.error("[Skedly] Unhandled error:", err);
    return new Response("Internal Server Error", { status: 500 });
  });

export type AppType = typeof app;

export { app };
