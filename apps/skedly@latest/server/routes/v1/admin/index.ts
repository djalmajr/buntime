import { Hono } from "hono";
import type { CfEnv } from "../../../lib/auth";
import { adminAuthMiddleware } from "../../../middleware/adminAuth";
import business from "./business";

export default new Hono<CfEnv>().use("*", adminAuthMiddleware).route("/", business);
