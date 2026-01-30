// Simple API client for fetching plugin information

export interface MenuItemInfo {
  icon: string;
  items?: MenuItemInfo[];
  path: string;
  priority?: number;
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
 * Fetch list of loaded plugins from the runtime API.
 */
export async function fetchLoadedPlugins(): Promise<PluginInfo[]> {
  const res = await fetch("/api/plugins/loaded");
  return res.json();
}
