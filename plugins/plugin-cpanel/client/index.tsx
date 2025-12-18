import { registerPiercingComponents } from "@buntime/piercing/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "~/contexts/auth-context";
import { getPluginBase, initPluginBases } from "~/helpers/api-client";
import { routeTree } from "./routeTree.gen";

import "~/helpers/i18n";

// Register piercing web components for micro-frontend support
registerPiercingComponents();

/**
 * Get base path from injected base tag or fallback.
 * Runtime injects `<base href="${basePath}/">` via x-base header.
 */
function getBasePath(): string {
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

function redirectToLogin() {
  const authnBase = getPluginBase("@buntime/plugin-authn");
  const currentPath = window.location.pathname + window.location.search;
  const loginUrl = `${authnBase}/login?redirect=${encodeURIComponent(currentPath)}`;
  window.location.href = loginUrl;
}

async function getSession(): Promise<Session | null> {
  const authnBase = getPluginBase("@buntime/plugin-authn");
  try {
    const res = await fetch(`${authnBase}/api/session`);
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    if (!data?.user) {
      return null;
    }
    return data as Session;
  } catch {
    return null;
  }
}

async function main() {
  // Initialize plugin bases before rendering
  await initPluginBases();

  // Check authentication before rendering
  const session = await getSession();

  if (!session) {
    redirectToLogin();
    return;
  }

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider context={{ session }} router={router} />
    </StrictMode>,
  );
}

main();
