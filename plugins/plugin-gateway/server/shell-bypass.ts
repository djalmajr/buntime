/**
 * Shell Bypass Logic
 * Determines if a request should bypass the AppShell based on basename
 */

// Regex para validar basename (alphanumeric, hyphen, underscore)
const VALID_BASENAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Parse comma-separated basenames, validate, and deduplicate
 */
export function parseBasenames(input: string): Set<string> {
  const basenames = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((basename) => VALID_BASENAME_REGEX.test(basename));

  return new Set(basenames);
}

/**
 * Extract basename from pathname
 * @example "/admin/users/123" → "admin"
 * @example "/" → ""
 * @example "/a" → "a"
 */
export function extractBasename(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] ?? "";
}

/**
 * Parse cookie value by name
 */
export function parseCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Check if request should bypass shell
 *
 * @param pathname - Request pathname
 * @param cookieHeader - Cookie header value
 * @param envExcludes - Excludes from environment/config (non-removable)
 * @param keyvalExcludes - Excludes from KeyVal persistence (removable via dashboard)
 */
export function shouldBypassShell(
  pathname: string,
  cookieHeader: string | null,
  envExcludes: Set<string>,
  keyvalExcludes: Set<string> = new Set(),
): boolean {
  const basename = extractBasename(pathname);
  if (!basename) return false;

  // 1. Check env excludes (from environment variable or config)
  if (envExcludes.has(basename)) {
    return true;
  }

  // 2. Check keyval excludes (from dashboard/persistence)
  if (keyvalExcludes.has(basename)) {
    return true;
  }

  // 3. Check cookie excludes (case-insensitive - accept both lowercase and uppercase)
  const cookieValue =
    parseCookieValue(cookieHeader, "gateway_shell_excludes") ||
    parseCookieValue(cookieHeader, "GATEWAY_SHELL_EXCLUDES");

  if (cookieValue) {
    const cookieExcludes = parseBasenames(cookieValue);
    if (cookieExcludes.has(basename)) {
      return true;
    }
  }

  return false;
}
