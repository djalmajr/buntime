import type { MetricsRoutesType } from "@buntime/plugin-metrics";
import type { ProxyRoutesType } from "@buntime/plugin-proxy";
import type { InternalRoutesType } from "@buntime/runner/routes/internal";
import { hc } from "hono/client";

// In dev, call buntime directly. In prod (served by buntime), use relative paths.
const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";

export const api = {
  internal: hc<InternalRoutesType>(`${API_BASE}/api`),
  metrics: hc<MetricsRoutesType>(`${API_BASE}/api/metrics`),
  proxy: hc<ProxyRoutesType>(`${API_BASE}/api/proxy`),
};
