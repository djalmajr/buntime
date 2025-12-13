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

// Hono routes for better-auth API
// Routes are relative (proxy strips /auth prefix)
const server = new Hono()
  // Better-auth handles all /api/* routes
  .all("/api/*", async (ctx) => {
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    return auth.handler(ctx.req.raw);
  })
  .all("/api", async (ctx) => {
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    return auth.handler(ctx.req.raw);
  })
  // Session endpoint
  .get("/session", async (ctx) => {
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    const session = await auth.api.getSession({
      headers: ctx.req.raw.headers,
    });
    return ctx.json(session);
  })
  // Logout
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
  });

export default server;
