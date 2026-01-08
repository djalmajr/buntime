import type { Session, User } from "better-auth";
import { type Context, Hono } from "hono";
import { type CfEnv, getAuth } from "../lib/auth";

const betterAuthHandler = async (ctx: Context<CfEnv>) => {
  // Clone the request to ensure body is available for BetterAuth
  // Hono may have consumed the body in middleware processing
  const clonedReq = ctx.req.raw.clone();
  return getAuth(ctx).handler(clonedReq);
};

export default new Hono<CfEnv>()
  .get("/session", async (ctx) => {
    const session = await getAuth(ctx).api.getSession({
      headers: ctx.req.raw.headers,
    });

    if (!session) {
      return ctx.json({ user: null, session: null }, 401);
    }

    return ctx.json({
      user: session.user as User,
      session: {
        id: session.session.id,
        userId: session.session.userId,
      } as Session,
    });
  })
  .get("/callback/google", betterAuthHandler)
  .post("/sign-in/email", betterAuthHandler)
  .post("/sign-in/social", betterAuthHandler)
  .post("/sign-up/email", betterAuthHandler)
  .post("/sign-out", betterAuthHandler);
