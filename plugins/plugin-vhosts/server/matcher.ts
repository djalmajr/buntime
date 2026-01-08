/**
 * Virtual host hostname matching logic
 */

export interface VHostConfig {
  /** Workspace app to serve (e.g., "skedly@latest") */
  app: string;
  /** Only serve paths starting with this prefix */
  pathPrefix?: string;
}

export interface VHostMatch {
  /** App name to serve */
  app: string;
  /** Path prefix filter */
  pathPrefix?: string;
  /** Tenant extracted from wildcard subdomain */
  tenant?: string;
}

/**
 * Match a hostname against virtual host configurations
 *
 * Supports:
 * - Exact matches: "sked.ly"
 * - Wildcard subdomains: "*.sked.ly" (captures subdomain as tenant)
 *
 * Priority: exact matches take precedence over wildcards
 *
 * @param hostname - Request hostname (e.g., "tenant1.sked.ly")
 * @param hosts - Virtual host configurations
 * @returns Match result or null if no match
 */
export function matchVirtualHost(
  hostname: string,
  hosts: Record<string, VHostConfig>,
): VHostMatch | null {
  // 1. Try exact match first (highest priority)
  const exactMatch = hosts[hostname];
  if (exactMatch) {
    return {
      app: exactMatch.app,
      pathPrefix: exactMatch.pathPrefix,
    };
  }

  // 2. Try wildcard matches (*.domain.com)
  for (const [pattern, config] of Object.entries(hosts)) {
    if (!pattern.startsWith("*.")) continue;

    const baseDomain = pattern.slice(2); // "*.sked.ly" -> "sked.ly"

    // Check if hostname ends with .baseDomain
    if (hostname.endsWith(`.${baseDomain}`)) {
      // Extract tenant (subdomain before base domain)
      const tenant = hostname.slice(0, -(baseDomain.length + 1));

      // Skip if tenant is empty (shouldn't match bare domain)
      if (!tenant) continue;

      return {
        app: config.app,
        pathPrefix: config.pathPrefix,
        tenant,
      };
    }
  }

  return null;
}
