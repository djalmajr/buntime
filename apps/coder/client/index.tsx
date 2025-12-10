import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";

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

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-900">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500" />
            <p className="text-zinc-400">Loading...</p>
          </div>
        </div>
      }
    >
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>,
);
