import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "~/helpers/api-client";

interface PluginInfo {
  name: string;
}

async function checkMetricsPlugin(): Promise<boolean> {
  try {
    const res = await api.plugins.index.$get();
    if (!res.ok) return false;
    const plugins = (await res.json()) as PluginInfo[];
    return plugins.some((p) => p.name === "@buntime/plugin-metrics");
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const hasMetrics = await checkMetricsPlugin();
    if (hasMetrics) {
      throw redirect({ to: "/metrics" });
    }
    throw redirect({ to: "/deployments" });
  },
});
