import { registerPiercingComponents } from "@buntime/piercing/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initPluginBases } from "~/helpers/api-client";
import { routeTree } from "./routeTree.gen";

import "~/helpers/i18n";

// Register piercing web components for micro-frontend support
registerPiercingComponents();

const base = document.querySelector("base");
const url = new URL(base?.href || "http://a.b");

const router = createRouter({
  basepath: url.pathname,
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

async function main() {
  // Initialize plugin bases before rendering
  await initPluginBases();

  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

main();
