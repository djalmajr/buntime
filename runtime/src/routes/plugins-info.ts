import type { BuntimePlugin, FragmentType } from "@buntime/shared/types";
import { Hono } from "hono";
import type { PluginRegistry } from "@/plugins/registry";
import { getPluginBase } from "@/utils/plugin-paths";

export interface PluginsInfoDeps {
  registry: PluginRegistry;
}

/**
 * Normalized fragment config returned by API
 */
export interface NormalizedFragmentConfig {
  enabled: boolean;
  type?: FragmentType;
  origin?: string;
  preloadStyles?: string;
}

/**
 * Normalize fragment config to consistent object
 */
function normalizeFragmentConfig(fragment: BuntimePlugin["fragment"]): NormalizedFragmentConfig {
  if (!fragment) {
    return { enabled: false };
  }

  return {
    enabled: true,
    type: fragment.type,
    origin: fragment.origin,
    preloadStyles: fragment.preloadStyles,
  };
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
      base: plugin.base ?? getPluginBase(plugin.name),
      dependencies: plugin.dependencies ?? [],
      fragment: normalizeFragmentConfig(plugin.fragment),
      menus: plugin.menus ?? [],
      name: plugin.name,
      optionalDependencies: plugin.optionalDependencies ?? [],
    }));
    return ctx.json(plugins);
  });
}

export type PluginsInfoRoutesType = ReturnType<typeof createPluginsInfoRoutes>;
