import { Kv } from "@buntime/keyval";

/**
 * Get the base path for API calls.
 * When loaded via fragment-outlet, extracts plugin path from src attribute.
 * Falls back to base tag for standalone mode.
 */
function getApiBase(): string {
  const rootElement = document.getElementById("plugin-keyval-root");
  if (!rootElement) return "/keyval";

  // Fragment content is inside Shadow DOM, host is the fragment-outlet
  const rootNode = rootElement.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    // Get the src attribute from fragment-outlet (this is where APIs are served)
    const outlet = rootNode.host;
    const src = outlet?.getAttribute("src");
    if (src) {
      // Extract the plugin path from src (e.g., "/keyval" from "/keyval/entries")
      const match = src.match(/^(\/[^/]+)/);
      return match?.[1] || "/keyval";
    }
  }

  // Fallback: read from base tag (standalone mode)
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "") || "/keyval";
  }
  return "/keyval";
}

export const kv = new Kv(`${getApiBase()}/api`);
