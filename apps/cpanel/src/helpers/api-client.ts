import type { MetricsRoutesType } from "@buntime/plugin-metrics";
import type { ProxyRoutesType } from "@buntime/plugin-proxy";
import type { InternalRoutesType } from "@buntime/server/routes/internal";
import { hc } from "hono/client";

// In dev, call buntime directly. In prod (served by buntime), use relative paths.
const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";

export const api = {
  internal: hc<InternalRoutesType>(`${API_BASE}/_`),
  metrics: hc<MetricsRoutesType>(`${API_BASE}/_/plugin-metrics`),
  proxy: hc<ProxyRoutesType>(`${API_BASE}/_/plugin-proxy`),
};
