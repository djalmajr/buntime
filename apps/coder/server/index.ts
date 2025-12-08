import { Hono } from "hono";
import api from "./api";

const app = new Hono().route("/api", api);

export default app;

export type AppType = typeof app;
