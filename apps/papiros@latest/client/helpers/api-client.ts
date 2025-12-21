import type { ApiType } from "@/index";
import { hc } from "hono/client";

const base = document.querySelector("base");
const path = base?.href ? new URL(base.href).pathname.replace(/\/$/, "") : "";

export const api = hc<ApiType>(`${location.origin}${path}/api`);
