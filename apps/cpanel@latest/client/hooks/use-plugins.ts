import { useQuery } from "@tanstack/react-query";
import { api } from "~/helpers/api-client";

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
  menus: MenuItemInfo[];
  name: string;
  optionalDependencies: string[];
}

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: async () => {
      const res = await api.plugins.loaded.$get();
      if (!res.ok) throw new Error("Failed to fetch plugins");
      return res.json() as Promise<PluginInfo[]>;
    },
    staleTime: Infinity, // Plugins don't change during runtime
  });
}

/**
 * Check if a specific plugin is enabled
 */
export function hasPlugin(plugins: PluginInfo[] | undefined, name: string): boolean {
  return plugins?.some((p) => p.name === name) ?? false;
}
