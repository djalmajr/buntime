import { Hono } from "hono";
import type { PluginRegistry } from "@/plugins/registry";

export interface PluginsInfoDeps {
  registry: PluginRegistry;
}

/**
 * Plugin info routes (/api/plugins)
 *
 * Returns full manifest of all loaded plugins including:
 * - name, base path
 * - fragment config (type, origin, etc.)
 * - menus (navigation items for shell sidebar)
 */
export function createPluginsInfoRoutes({ registry }: PluginsInfoDeps) {
  return new Hono().get("/", (ctx) => {
    const plugins = registry.getAll().map((plugin) => ({
      base: plugin.base,
      dependencies: plugin.dependencies ?? [],
      fragment: plugin.fragment
        ? {
            enabled: true,
            origin: plugin.fragment.origin,
            preloadStyles: plugin.fragment.preloadStyles,
            type: plugin.fragment.type,
          }
        : { enabled: false },
      menus: plugin.menus ?? [],
      name: plugin.name,
      optionalDependencies: plugin.optionalDependencies ?? [],
    }));
    return ctx.json(plugins);
  });
}

export type PluginsInfoRoutesType = ReturnType<typeof createPluginsInfoRoutes>;
