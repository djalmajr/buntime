// API client with dynamic plugin bases
import type { AuthzRoutesType } from "@buntime/plugin-authz";
import type { DurableRoutesType } from "@buntime/plugin-durable";
import type { GatewayRoutesType } from "@buntime/plugin-gateway";
import type { KeyvalRoutesType } from "@buntime/plugin-keyval";
import type { MetricsRoutesType } from "@buntime/plugin-metrics";
import type { ProxyRoutesType } from "@buntime/plugin-proxy";
import type { DeploymentRoutesType } from "@buntime/runtime/routes/deployments";
import type { PluginsInfoRoutesType } from "@buntime/runtime/routes/plugins-info";
import { hc } from "hono/client";

interface PluginInfo {
  base?: string;
  dependencies: string[];
  name: string;
  optionalDependencies: string[];
}

const API_BASE = location.origin;

// Plugin bases cache - populated by initPluginBases()
const bases: Record<string, string> = {};

/**
 * Initialize plugin bases from /api/plugins endpoint.
 * Must be called before using the api object.
 */
export async function initPluginBases(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/plugins`);
  const plugins: PluginInfo[] = await res.json();

  for (const plugin of plugins) {
    const name = plugin.name.replace(/^@[^/]+\//, "").replace(/^plugin-/, "");
    bases[name] = plugin.base ?? `/api/${name}`;
  }
}

function getBase(name: string): string {
  return bases[name] ?? `/api/${name}`;
}

// Lazy-initialized clients cache
const clients: Record<string, unknown> = {};

function getClient<T>(name: string, factory: () => T): T {
  clients[name] ||= factory();
  return clients[name] as T;
}

export const api = {
  get authz() {
    return getClient("authz", () => hc<AuthzRoutesType>(`${API_BASE}${getBase("authz")}`));
  },
  get deployments() {
    return getClient("deployments", () => hc<DeploymentRoutesType>(`${API_BASE}/api/deployments`));
  },
  get durable() {
    return getClient("durable", () => hc<DurableRoutesType>(`${API_BASE}${getBase("durable")}`));
  },
  get gateway() {
    return getClient("gateway", () => hc<GatewayRoutesType>(`${API_BASE}${getBase("gateway")}`));
  },
  get keyval() {
    return getClient("keyval", () => hc<KeyvalRoutesType>(`${API_BASE}${getBase("keyval")}`));
  },
  get metrics() {
    return getClient("metrics", () => hc<MetricsRoutesType>(`${API_BASE}${getBase("metrics")}`));
  },
  get plugins() {
    return getClient("plugins", () => hc<PluginsInfoRoutesType>(`${API_BASE}/api/plugins`));
  },
  get proxy() {
    return getClient("proxy", () => hc<ProxyRoutesType>(`${API_BASE}${getBase("proxy")}`));
  },
};
