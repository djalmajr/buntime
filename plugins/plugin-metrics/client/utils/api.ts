import { hc } from "hono/client";
import type { MetricsRoutesType } from "../../server/api";

function getBasePath(): string {
  const outlet = document.querySelector("piercing-fragment-outlet[data-fragment-base]");
  if (outlet) {
    const fragmentBase = outlet.getAttribute("data-fragment-base");
    if (fragmentBase) {
      return fragmentBase.replace(/\/$/, "");
    }
  }

  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }
  return "";
}

function createApi() {
  const basePath = getBasePath();
  // hc requires an absolute URL
  const baseUrl = `${window.location.origin}${basePath}/api`;
  return hc<MetricsRoutesType>(baseUrl);
}

// Lazy initialization to ensure DOM is ready
let _api: ReturnType<typeof createApi> | null = null;

export function getApi() {
  if (!_api) {
    _api = createApi();
  }
  return _api;
}

// For backwards compatibility, export a proxy that lazily initializes
export const api = new Proxy({} as ReturnType<typeof createApi>, {
  get(_, prop) {
    return getApi()[prop as keyof ReturnType<typeof createApi>];
  },
});
