// Pattern: 01-, 02-, 1-, 2-, 001-, etc.
const NUMERIC_PREFIX_REGEX = /^(\d+)-/;

/**
 * Extract numeric prefix from a name (e.g., "01-intro" → 1)
 */
export function extractNumericPrefix(name: string): number | null {
  const match = name.match(NUMERIC_PREFIX_REGEX);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Remove numeric prefix from a name (e.g., "01-intro" → "intro")
 */
export function removeNumericPrefix(name: string): string {
  return name.replace(NUMERIC_PREFIX_REGEX, "");
}

/**
 * Format file/folder name for display
 * Removes numeric prefix, .adoc extension and replaces - and _ with spaces
 */
export function formatName(name: string): string {
  return removeNumericPrefix(name)
    .replace(".adoc", "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert a name to URL-friendly slug (kebab-case)
 * Removes numeric prefix before generating slug
 * e.g., "01-getting-started.adoc" → "getting-started"
 */
export function toSlug(name: string): string {
  return removeNumericPrefix(name)
    .replace(/\.adoc$/, "")
    .toLowerCase()
    .replace(/[._\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build full slug path from file path
 * e.g., "releases/v1.0.0.adoc" → "releases/v1-0-0"
 */
export function buildSlugPath(filePath: string): string {
  return filePath.split("/").map(toSlug).join("/");
}
