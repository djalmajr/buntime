import type { Session, User } from "better-auth";
import { createMiddleware } from "hono/factory";
import { type CfEnv, getAuth } from "../lib/auth";

export const authMiddleware = createMiddleware<CfEnv>(async (ctx, next) => {
  const auth = await getAuth(ctx).api.getSession({
    headers: ctx.req.raw.headers,
  });

  if (auth) {
    ctx.set("user", auth.user as User);
    ctx.set("session", auth.session as Session);
  } else {
    ctx.set("user", null);
    ctx.set("session", null);
  }

  await next();
});
