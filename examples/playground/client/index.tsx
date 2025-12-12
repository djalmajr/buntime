import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "~/helpers/query-client";
import { routeTree } from "./routeTree.gen";

import "~/helpers/i18n";

const base = document.querySelector("base");
const url = new URL(base?.href || "http://a.b");

const router = createRouter({
  basepath: url.pathname,
  context: {},
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultStructuralSharing: true,
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root")!;

// Preserve React root across HMR to avoid unmount/remount
const root = rootElement._reactRoot ?? createRoot(rootElement);
rootElement._reactRoot = root;

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

declare global {
  interface HTMLElement {
    _reactRoot?: ReturnType<typeof createRoot>;
  }
}
