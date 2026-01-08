import type { User } from "better-auth";
import { createMiddleware } from "hono/factory";
import type { CfEnv } from "@/lib/auth";

export const adminAuthMiddleware = createMiddleware<CfEnv>(async (ctx, next) => {
  const user = ctx.get("user") as User | null;

  if (!user) {
    return ctx.json({ error: "Unauthorized" }, 401);
  }

  if (user.role !== "admin") {
    return ctx.json({ error: "Forbidden" }, 403);
  }

  await next();
});
