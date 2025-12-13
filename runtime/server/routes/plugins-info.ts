import { Hono } from "hono";
import type { PluginRegistry } from "@/plugins/registry";

export interface PluginsInfoDeps {
  registry: PluginRegistry;
}

/**
 * Plugin info routes (/api/plugins)
 *
 * Returns metadata about loaded plugins.
 */
export function createPluginsInfoRoutes({ registry }: PluginsInfoDeps) {
  return new Hono().get("/", (ctx) => {
    const plugins = registry.getAll().map((plugin) => ({
      base: plugin.base,
      dependencies: plugin.dependencies ?? [],
      name: plugin.name,
      optionalDependencies: plugin.optionalDependencies ?? [],
      version: plugin.version,
    }));
    return ctx.json(plugins);
  });
}

export type PluginsInfoRoutesType = ReturnType<typeof createPluginsInfoRoutes>;
