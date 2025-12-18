import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import { getAuth, getLogger, getProviders } from "./services";

// API routes (mounted at /api by worker, runs on main thread via plugin.routes)
export const api = new Hono()
  .basePath("/api")
  // Get configured providers for login UI
  .get("/providers", (ctx) => {
    return ctx.json(getProviders());
  })
  // Better-auth handles all auth routes
  .all("/auth/*", async (ctx) => {
    const auth = getAuth();
    const logger = getLogger();
    if (!auth) {
      logger?.error("Auth not configured");
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    try {
      // Rewrite URL to match better-auth basePath
      const url = new URL(ctx.req.url);
      const newPath = "/auth" + url.pathname;
      const newUrl = new URL(newPath + url.search, url.origin);
      const newReq = new Request(newUrl.toString(), ctx.req.raw);
      logger?.debug("Auth route hit", { originalPath: ctx.req.path, rewrittenPath: newPath });
      return await auth.handler(newReq);
    } catch (err) {
      logger?.error("Auth handler error", { error: String(err) });
      throw err;
    }
  })
  .all("/auth", async (ctx) => {
    const auth = getAuth();
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    return auth.handler(ctx.req.raw);
  })
  // Session endpoint
  .get("/session", async (ctx) => {
    const auth = getAuth();
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    const session = await auth.api.getSession({
      headers: ctx.req.raw.headers,
    });
    return ctx.json(session);
  })
  // Logout endpoints
  .get("/logout", async (ctx) => {
    const auth = getAuth();
    const redirect = ctx.req.query("redirect") || "/";
    if (auth) {
      await auth.api.signOut({ headers: ctx.req.raw.headers });
    }
    return ctx.redirect(redirect);
  })
  .post("/logout", async (ctx) => {
    const auth = getAuth();
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    await auth.api.signOut({ headers: ctx.req.raw.headers });
    return ctx.json({ success: true });
  })
  .onError((err) => {
    const logger = getLogger();
    logger?.error("AuthN API error", { error: err.message });
    return errorToResponse(err);
  });

// Export type for API client
export type ApiType = typeof api;
