import { useQuery } from "@tanstack/react-query";
import { api } from "~/helpers/api-client";

export interface PluginInfo {
  base?: string;
  dependencies: string[];
  name: string;
  optionalDependencies: string[];
  version: string;
}

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: async () => {
      const res = await api.plugins.index.$get();
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
