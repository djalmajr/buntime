/**
 * Extract short name from plugin name
 * @example "@buntime/plugin-keyval" -> "keyval"
 */
export function getPluginShortName(pluginName: string): string {
  return pluginName.replace(/^@[^/]+\//, "").replace(/^plugin-/, "");
}
