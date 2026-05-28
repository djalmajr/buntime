/** Per-host config injected by the worker (index.ts) as `window.__config`. */

export interface AuthConfig {
  url: string;
  realm: string;
  clientId: string;
}

export interface CatalogApp {
  name: string;
  url: string;
  icon?: string;
}

declare global {
  interface Window {
    __config?: { auth?: AuthConfig };
  }
}

/** The Keycloak config for this host, or undefined if the host is unknown. */
export function getAuthConfig(): AuthConfig | undefined {
  return window.__config?.auth;
}

/** Fetch the host's app catalog from the platform app (public, by host). */
export async function fetchCatalog(): Promise<CatalogApp[]> {
  const res = await fetch(`${window.location.origin}/platform/api/catalog`);
  if (!res.ok) return [];
  return (await res.json()) as CatalogApp[];
}
