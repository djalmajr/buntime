import { Hono } from "hono";
import { errorToResponse } from "@/libs/errors";
import internal from "@/routes/internal/index";
import workers from "@/routes/worker";

const app = new Hono().route("/_", internal).route("/", workers).onError(errorToResponse);

export type AppType = typeof app;

export default app;
