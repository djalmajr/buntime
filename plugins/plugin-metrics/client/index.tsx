import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";

// Get basepath from fragment outlet attributes
function getBasePath(): string {
  const rootElement = document.getElementById("plugin-metrics-root");

  // Fragment content is inside Shadow DOM, host is the fragment-outlet
  const rootNode = rootElement?.getRootNode();
  const outlet =
    rootNode instanceof ShadowRoot && rootNode.host?.tagName?.toLowerCase() === "fragment-outlet"
      ? rootNode.host
      : null;

  // When loaded via shell (cpanel), use shell base + segment
  // e.g., /cpanel + /metrics = /cpanel/metrics
  const shellBase = outlet?.getAttribute("base");
  if (shellBase) {
    const pathname = window.location.pathname;
    // Extract fragment segment from URL (e.g., /cpanel/metrics/workers -> metrics)
    const afterShell = pathname.slice(shellBase.length);
    const match = afterShell.match(/^\/([^/]+)/);
    const segment = match?.[1] || "metrics";
    return `${shellBase}/${segment}`;
  }

  // When loaded directly via /p/metrics, use fragment base
  const fragmentBase = outlet?.getAttribute("data-fragment-base");
  if (fragmentBase) return fragmentBase;

  // Fallback: read from base tag
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "/metrics";
}

const rootElement = document.getElementById("plugin-metrics-root");
if (!rootElement) throw new Error("Root element not found");

const router = createRouter({
  basepath: getBasePath(),
  routeTree,
});

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Cleanup when fragment is unmounted
rootElement
  .getRootNode()
  .addEventListener("piercing-unmount", () => root.unmount(), { once: true });
