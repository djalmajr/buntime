/**
 * Extract short name from plugin name
 * @example "@buntime/plugin-keyval" -> "keyval"
 */
export function getPluginShortName(pluginName: string): string {
  return pluginName.replace(/^@[^/]+\//, "").replace(/^plugin-/, "");
}

/**
 * Get the default base path for a plugin
 * Used for both API routes and fragment apps
 *
 * All plugin routes are under /{base}/*:
 * - Fragment UI: /{base}/
 * - API routes: /{base}/api/*
 *
 * @example "@buntime/plugin-keyval" -> "/keyval"
 */
export function getPluginBase(pluginName: string): string {
  return `/${getPluginShortName(pluginName)}`;
}
