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
 * All plugin routes are under /p/{name}/*:
 * - Fragment UI: /p/{name}/
 * - API routes: /p/{name}/api/*
 *
 * The /p/ prefix ensures plugin routes don't conflict with app workers.
 *
 * @example "@buntime/plugin-keyval" -> "/p/keyval"
 */
export function getPluginBase(pluginName: string): string {
  return `/p/${getPluginShortName(pluginName)}`;
}
