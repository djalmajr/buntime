import { useQuery } from "@tanstack/react-query";
import { fetchLoadedPlugins } from "~/helpers/api-client";

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: fetchLoadedPlugins,
    staleTime: Infinity, // Plugins don't change during runtime
  });
}
