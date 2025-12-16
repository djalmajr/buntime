import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MetricsPage } from "./components/metrics-page";

const rootElement = document.getElementById("plugin-metrics-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <MetricsPage />
  </StrictMode>,
);

// Cleanup when fragment is unmounted
rootElement
  .getRootNode()
  .addEventListener("piercing-unmount", () => root.unmount(), { once: true });
