function getApiBase(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "/authz";
}

export const basePath = getApiBase();

/**
 * Same-origin fetch that includes the cpanel session cookie. The runtime's
 * shared middleware reads the cookie automatically — no header to inject.
 */
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "same-origin" });
}
