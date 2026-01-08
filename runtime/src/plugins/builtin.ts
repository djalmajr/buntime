/**
 * Built-in plugins registry
 *
 * All plugins use lazy loading for consistent behavior
 * and to avoid bundling issues with compiled binaries.
 */

import type { PluginFactory } from "@buntime/shared/types";

/**
 * Map of plugin names to their lazy loaders
 */
const plugins: Record<string, () => Promise<PluginFactory>> = {
  "@buntime/plugin-authn": async () => (await import("@buntime/plugin-authn")).default,
  "@buntime/plugin-authz": async () => (await import("@buntime/plugin-authz")).default,
  "@buntime/plugin-database": async () => (await import("@buntime/plugin-database")).default,
  "@buntime/plugin-deployments": async () => (await import("@buntime/plugin-deployments")).default,
  "@buntime/plugin-durable": async () => (await import("@buntime/plugin-durable")).default,
  "@buntime/plugin-gateway": async () => (await import("@buntime/plugin-gateway")).default,
  "@buntime/plugin-keyval": async () => (await import("@buntime/plugin-keyval")).default,
  "@buntime/plugin-metrics": async () => (await import("@buntime/plugin-metrics")).default,
  "@buntime/plugin-proxy": async () => (await import("@buntime/plugin-proxy")).default,
};

/**
 * Get a built-in plugin factory by name
 * Built-in plugins are embedded in the binary for production use
 */
export async function getBuiltinPlugin(name: string): Promise<PluginFactory | undefined> {
  const loader = plugins[name];
  return loader ? await loader() : undefined;
}
