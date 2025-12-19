import { registerPiercingComponents } from "@buntime/piercing/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "~/contexts/auth-context";
import { getPluginBase, initPluginBases, isPluginLoaded } from "~/helpers/api-client";
import { routeTree } from "./routeTree.gen";

import "~/helpers/i18n";

// Register piercing web components for micro-frontend support
registerPiercingComponents();

// Declare global variables injected by the runtime for app-shell mode
declare global {
  interface Window {
    __FRAGMENT_ROUTE__?: string;
    __NOT_FOUND__?: boolean;
    __ROUTER_BASEPATH__?: string;
  }
}

/**
 * Get base path for the router.
 * In app-shell mode, __ROUTER_BASEPATH__ is injected to override the base tag.
 * This allows assets to load from /cpanel while router manages routes from /.
 */
function getBasePath(): string {
  // App-shell mode: use injected basepath for router
  if (window.__ROUTER_BASEPATH__) {
    return window.__ROUTER_BASEPATH__;
  }

  // Normal mode: use base tag
  const base = document.querySelector("base");
  if (base?.href) {
    const url = new URL(base.href);
    return url.pathname.replace(/\/$/, "") || "/";
  }

  // Fallback: infer from URL path (for direct access without base injection)
  // e.g., /cpanel/dashboard -> /cpanel
  const match = window.location.pathname.match(/^(\/[^/]+)/);
  return match?.[1] || "/";
}

const router = createRouter({
  basepath: getBasePath(),
  context: {
    session: undefined!,
  },
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

async function getSession(): Promise<Session | undefined> {
  const authnBase = getPluginBase("@buntime/plugin-authn");
  try {
    const res = await fetch(`${authnBase}/api/session`);
    if (!res.ok) {
      return undefined;
    }
    const data = await res.json();
    if (!data?.user) {
      return undefined;
    }
    return data as Session;
  } catch {
    return undefined;
  }
}

async function main() {
  // Initialize plugin bases before rendering
  await initPluginBases();

  // Fetch session for UI (authentication is handled server-side)
  // If plugin-authn is not loaded, session will be undefined (Guest mode)
  let session: Session | undefined;
  if (isPluginLoaded("@buntime/plugin-authn")) {
    session = await getSession();
  }

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  // App-shell mode: navigate to the fragment route if injected by runtime
  // This handles direct navigation to plugin URLs (e.g., /metrics, /keyval)
  const fragmentRoute = window.__FRAGMENT_ROUTE__;
  if (fragmentRoute && fragmentRoute !== "/") {
    // Navigate to the fragment route after hydration
    // The router will handle this path via the catch-all route ($)
    await router.navigate({ to: fragmentRoute, replace: true });
  }

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider context={{ session }} router={router} />
    </StrictMode>,
  );
}

main();
