import type { AppType } from "@buntime/server";
import { hc } from "hono/client";

export type Client = ReturnType<typeof hc<AppType>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client => hc<AppType>(...args);

export const api = hcWithType("/");
