import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MetricsPage } from "./components/metrics-page";

const rootElement = document.getElementById("plugin-metrics-root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <MetricsPage />
  </StrictMode>,
);
