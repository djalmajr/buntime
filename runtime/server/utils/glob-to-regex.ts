/**
 * Convert glob pattern to regex pattern
 * Supports:
 * - * (matches any characters except /)
 * - ** (matches any characters including /)
 * - ? (matches single character)
 * - [...] (character class)
 * - Regular regex patterns (passed through if wrapped in parentheses)
 */
export function globToRegex(pattern: string): string {
  // If pattern looks like a regex (starts with parentheses), return as-is
  // Don't add ^ or $ to regex patterns
  if (pattern.startsWith("(")) {
    return pattern;
  }

  // Escape special regex characters except glob wildcards
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*\*/g, "___DOUBLE_STAR___") // Temporarily replace **
    .replace(/\*/g, "[^/]*") // * matches any char except /
    .replace(/___DOUBLE_STAR___/g, ".*") // ** matches any char including /
    .replace(/\?/g, "."); // ? matches single char

  // Ensure pattern matches from start to end (full match, not prefix)
  if (!regex.startsWith("^")) {
    regex = `^${regex}`;
  }

  if (!regex.endsWith("$")) {
    regex = `${regex}$`;
  }

  return regex;
}

/**
 * Convert array of glob patterns to a single combined RegExp
 * Returns null if array is empty
 */
export function globArrayToRegex(patterns: string[]): RegExp | null {
  if (!patterns || patterns.length === 0) return null;

  const regexPatterns = patterns.map(globToRegex);
  return new RegExp(`(${regexPatterns.join("|")})`);
}
