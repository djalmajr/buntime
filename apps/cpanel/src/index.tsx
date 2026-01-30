import "@zomme/frame"; // Registers <z-frame> web component
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";

import "~/helpers/i18n";

/**
 * Get base path for the router from the <base> tag.
 */
function getBasePath(): string {
  const base = document.querySelector("base");
  if (base?.href) {
    const url = new URL(base.href);
    return url.pathname.replace(/\/$/, "") || "/";
  }
  return "/";
}

const router = createRouter({
  basepath: getBasePath(),
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
