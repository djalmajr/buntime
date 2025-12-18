import { createRouter, RouterProvider } from "@tanstack/react-router";
import i18n from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import pt from "./locales/pt.json";
import { routeTree } from "./routeTree.gen";

i18n.use(initReactI18next).init({
  debug: false,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  lng: "en",
  resources: {
    en: { translation: en },
    pt: { translation: pt },
  },
});

// Get basepath from fragment outlet or base tag
function getBasePath(): string {
  const rootElement = document.getElementById("plugin-keyval-root");

  // Fragment content is inside Shadow DOM, host is the fragment-outlet
  const rootNode = rootElement?.getRootNode();
  const outlet =
    rootNode instanceof ShadowRoot && rootNode.host?.tagName?.toLowerCase() === "fragment-outlet"
      ? rootNode.host
      : null;

  // When loaded via fragment-outlet, use the base attribute passed by the shell
  const base = outlet?.getAttribute("base");
  if (base) {
    return base;
  }

  // Fallback: read from base tag (when loaded directly, not via fragment-outlet)
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "/keyval";
}

const rootElement = document.getElementById("plugin-keyval-root");
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
