import { Hono } from "hono";
import type { CfEnv } from "../../lib/auth";
import { authMiddleware } from "../../middleware/auth";
import admin from "./admin";
import appointments from "./appointments";
import users from "./users";

export default new Hono<CfEnv>()
  .use("*", authMiddleware)
  .route("/appointments", appointments)
  .route("/users", users)
  .route("/admin", admin);
