/**
 * Pattern for valid plugin short names (alphanumeric and hyphens only)
 * Security: Prevents path traversal attacks via plugin names
 */
const VALID_SHORT_NAME_PATTERN = /^[a-z0-9-]+$/i;

/**
 * Extract short name from plugin package name
 * Security: Validates the result to prevent path traversal
 *
 * @example "@buntime/plugin-keyval" -> "keyval"
 * @example "@buntime/keyval" -> "keyval"
 * @example "@other/plugin-foo" -> "foo"
 * @throws Error if resulting name contains path traversal characters
 */
export function getShortName(pluginName: string): string {
  const shortName = pluginName.replace(/^@[^/]+\/(plugin-)?/, "");

  // Security: Reject names that could be path traversal attempts
  if (!VALID_SHORT_NAME_PATTERN.test(shortName)) {
    throw new Error(
      `Invalid plugin name "${pluginName}": short name "${shortName}" contains invalid characters. ` +
        `Only alphanumeric characters and hyphens are allowed.`,
    );
  }

  return shortName;
}
