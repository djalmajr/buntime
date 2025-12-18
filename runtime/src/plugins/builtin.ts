/**
 * Built-in plugins registry
 *
 * Plugins without native dependencies are imported statically.
 * Plugins with native dependencies (keyval, durable) use lazy loading
 * to avoid bundling issues with compiled binaries.
 */

import authn from "@buntime/plugin-authn";
import authz from "@buntime/plugin-authz";
import cpanel from "@buntime/plugin-cpanel";
import gateway from "@buntime/plugin-gateway";
import metrics from "@buntime/plugin-metrics";
import proxy from "@buntime/plugin-proxy";
import type { PluginFactory } from "@buntime/shared/types";

/**
 * Plugins with native dependencies (libsql)
 * These are loaded lazily to avoid bundling native binaries
 */
const lazyPlugins: Record<string, () => Promise<PluginFactory>> = {
  "@buntime/plugin-database": async () =>
    (await import("@buntime/plugin-database")).default as unknown as PluginFactory,
  "@buntime/plugin-durable": async () => (await import("@buntime/plugin-durable")).default,
  "@buntime/plugin-keyval": async () => (await import("@buntime/plugin-keyval")).default,
};

/**
 * Map of plugin names to their factory functions (static plugins)
 */
const staticPlugins: Record<string, PluginFactory> = {
  "@buntime/plugin-authn": authn,
  "@buntime/plugin-authz": authz,
  "@buntime/plugin-cpanel": cpanel,
  "@buntime/plugin-gateway": gateway,
  "@buntime/plugin-metrics": metrics,
  "@buntime/plugin-proxy": proxy,
};

/**
 * Check if a plugin is built-in (static or lazy)
 */
export function isBuiltinPlugin(name: string): boolean {
  return name in staticPlugins || name in lazyPlugins;
}

/**
 * Get a built-in plugin factory by name
 * Returns a factory function or undefined
 */
export async function getBuiltinPlugin(name: string): Promise<PluginFactory | undefined> {
  // Try static plugins first
  if (name in staticPlugins) {
    return staticPlugins[name];
  }

  // Try lazy plugins
  if (name in lazyPlugins) {
    return await lazyPlugins[name]!();
  }

  return undefined;
}
