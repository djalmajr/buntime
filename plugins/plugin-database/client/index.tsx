import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";

function getBasePath(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "/database";
}

const rootElement = document.getElementById("plugin-database-root");
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
