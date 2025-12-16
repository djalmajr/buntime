import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import { type Auth, createBetterAuth } from "./auth";

// Read config from environment variables
const {
  AUTHN_CLIENT_ID = "",
  AUTHN_CLIENT_SECRET = "",
  AUTHN_DATABASE_PATH = "./data/auth.db",
  AUTHN_ISSUER = "",
  AUTHN_TRUSTED_ORIGINS = "",
} = Bun.env;

// Parse trusted origins from comma-separated string
const trustedOrigins = AUTHN_TRUSTED_ORIGINS
  ? AUTHN_TRUSTED_ORIGINS.split(",").map((s) => s.trim())
  : [];

// Initialize better-auth
let auth: Auth | null = null;
if (AUTHN_ISSUER && AUTHN_CLIENT_ID) {
  auth = createBetterAuth({
    clientId: AUTHN_CLIENT_ID,
    clientSecret: AUTHN_CLIENT_SECRET,
    databasePath: AUTHN_DATABASE_PATH,
    issuer: AUTHN_ISSUER,
    trustedOrigins,
  });
}

// API routes for better-auth (mounted at /api by worker)
export const api = new Hono()
  .basePath("/api")
  // Better-auth handles all auth routes
  .all("/*", async (ctx) => {
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    return auth.handler(ctx.req.raw);
  })
  .all("/", async (ctx) => {
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    return auth.handler(ctx.req.raw);
  })
  .onError((err) => {
    console.error("[AuthN] Error:", err);
    return errorToResponse(err);
  });

// Session and logout routes (not under /api)
export const routes = new Hono()
  .get("/session", async (ctx) => {
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    const session = await auth.api.getSession({
      headers: ctx.req.raw.headers,
    });
    return ctx.json(session);
  })
  .get("/logout", async (ctx) => {
    const redirect = ctx.req.query("redirect") || "/";
    if (auth) {
      await auth.api.signOut({ headers: ctx.req.raw.headers });
    }
    return ctx.redirect(redirect);
  })
  .post("/logout", async (ctx) => {
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    await auth.api.signOut({ headers: ctx.req.raw.headers });
    return ctx.json({ success: true });
  })
  .onError((err) => {
    console.error("[AuthN] Error:", err);
    return errorToResponse(err);
  });
