import { registry } from "virtual:icons";
import { IconProvider } from "@buntime/shadcn-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "~/helpers/query-client";
import { routeTree } from "./routeTree.gen";

import "~/helpers/i18n";
import "./index.css";

const base = document.querySelector("base");
const url = new URL(base?.href || "http://a.b");

const router = createRouter({
  basepath: url.pathname.replace(/\/$/, "") || "/",
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
    <IconProvider registry={registry}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IconProvider>
  </StrictMode>,
);
