// Simple API client for fetching plugin information

export interface MenuItemInfo {
  icon: string;
  items?: MenuItemInfo[];
  path: string;
  title: string;
}

export interface PluginInfo {
  base?: string;
  dependencies: string[];
  menus?: MenuItemInfo[];
  name: string;
  optionalDependencies: string[];
}

/**
 * Runtime configuration from /.well-known/buntime
 */
interface RuntimeConfig {
  api: string;
  version: string;
}

/** Cached runtime config */
let runtimeConfig: RuntimeConfig | null = null;

/**
 * Fetch runtime configuration from well-known endpoint.
 * Caches the result for subsequent calls.
 */
async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (runtimeConfig) return runtimeConfig;
  const res = await fetch("/.well-known/buntime");
  const config: RuntimeConfig = await res.json();
  runtimeConfig = config;
  return config;
}

/**
 * Fetch list of loaded plugins from the runtime API.
 * Discovers API path dynamically via /.well-known/buntime
 */
export async function fetchLoadedPlugins(): Promise<PluginInfo[]> {
  const { api } = await getRuntimeConfig();
  const res = await fetch(`${api}/plugins/loaded`);
  return res.json();
}
