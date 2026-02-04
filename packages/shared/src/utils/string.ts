/**
 * Split a string by separator, trim whitespace, and filter empty values.
 *
 * @param value - String to split
 * @param separator - Separator character or string (default: ",")
 * @returns Array of trimmed, non-empty strings
 *
 * @example
 * ```typescript
 * // Comma-separated (default)
 * splitList(".cache, cli, runtime")     // [".cache", "cli", "runtime"]
 * splitList("a,b,,c")                   // ["a", "b", "c"]
 *
 * // Colon-separated (PATH-style)
 * splitList("/path1:/path2", ":")       // ["/path1", "/path2"]
 *
 * // Semicolon-separated (SQL statements)
 * splitList("SELECT 1; SELECT 2", ";")  // ["SELECT 1", "SELECT 2"]
 *
 * // Handles whitespace
 * splitList("  a , b , c  ")            // ["a", "b", "c"]
 * ```
 */
export function splitList(value: string, separator = ","): string[] {
  return value
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);
}
