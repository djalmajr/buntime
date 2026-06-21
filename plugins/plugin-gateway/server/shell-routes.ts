/**
 * Per-tenant (per-host) app-shell routing.
 *
 * The gateway serves a central app-shell for browser navigations. By default a
 * single global shellDir serves every host; a shell route overrides that for a
 * specific host (tenant), so different tenants can run different shells — or the
 * same shell pinned to a different version. The value is a shell worker install
 * directory, e.g. `/data/apps/@acme/shell/1.0.0`.
 */
export interface ShellRoute {
  /** Host this route applies to: exact (`tenant.example.com`) or wildcard (`*.example.com`). */
  host: string;
  /** Shell worker install directory to serve for this host. */
  dir: string;
  /** Creation timestamp (epoch ms). */
  createdAt?: number;
}

// Hostnames, optionally a leading `*.` wildcard label. Lowercased before testing.
const ROUTE_HOST_RE = /^(\*\.)?[a-z0-9._-]+$/;

/**
 * Validate and normalize a route host (lowercased). Returns null when invalid,
 * so callers can reject the input.
 */
export function normalizeRouteHost(host: string): string | null {
  const normalized = host.trim().toLowerCase();
  if (!normalized || !ROUTE_HOST_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

/** Normalize an incoming request host: strip the port and lowercase. */
export function normalizeRequestHost(host: string): string {
  return host.trim().toLowerCase().split(":")[0] ?? "";
}

/**
 * Resolve the shell directory for a request host. An exact host match wins;
 * otherwise the most specific matching wildcard (`*.example.com` matches
 * `a.example.com`) is used. Returns undefined when nothing matches, so the
 * caller falls back to the global shellDir.
 */
export function matchShellRouteDir(host: string, routes: Iterable<ShellRoute>): string | undefined {
  const normalized = normalizeRequestHost(host);
  if (!normalized) {
    return undefined;
  }

  let exact: string | undefined;
  let wildcard: string | undefined;
  let wildcardSuffixLen = -1;

  for (const route of routes) {
    if (route.host === normalized) {
      exact = route.dir;
    } else if (route.host.startsWith("*.")) {
      const suffix = route.host.slice(1); // ".example.com"
      if (normalized.endsWith(suffix) && suffix.length > wildcardSuffixLen) {
        wildcard = route.dir;
        wildcardSuffixLen = suffix.length;
      }
    }
  }

  return exact ?? wildcard;
}
