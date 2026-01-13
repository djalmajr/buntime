// API client with dynamic plugin bases
import type { PluginsRoutesType } from "@buntime/runtime/routes/plugins";
import { hc } from "hono/client";

interface PluginInfo {
  base?: string;
  dependencies: string[];
  name: string;
  optionalDependencies: string[];
}

const API_BASE = location.origin;

// Plugin bases cache - populated by initPluginBases()
// Stores both full name (@buntime/plugin-authn) and short name (authn)
const bases: Record<string, string> = {};

/**
 * Initialize plugin bases from /api/plugins/loaded endpoint.
 * Must be called before using the api object.
 */
export async function initPluginBases(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/plugins/loaded`);
  const plugins: PluginInfo[] = await res.json();

  for (const plugin of plugins) {
    const shortName = plugin.name.replace(/^@[^/]+\//, "").replace(/^plugin-/, "");
    const base = plugin.base ?? `/${shortName}`;

    // Store by full name and short name for flexibility
    bases[plugin.name] = base;
    bases[shortName] = base;
  }
}

/**
 * Check if a plugin is loaded by name.
 * Supports both full name (@buntime/plugin-authn) and short name (authn).
 */
export function isPluginLoaded(name: string): boolean {
  return name in bases;
}

/**
 * Get plugin base path by name.
 * Supports both full name (@buntime/plugin-authn) and short name (authn).
 */
export function getPluginBase(name: string): string {
  return bases[name] ?? `/${name.replace(/^@[^/]+\//, "").replace(/^plugin-/, "")}`;
}

// Lazy-initialized clients cache
const clients: Record<string, unknown> = {};

function getClient<T>(name: string, factory: () => T): T {
  clients[name] ||= factory();
  return clients[name] as T;
}

export const api = {
  get plugins() {
    return getClient("plugins", () => hc<PluginsRoutesType>(`${API_BASE}/api/plugins`));
  },
};
