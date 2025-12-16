import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HealthDashboard } from "./components/health-dashboard";

// Use a unique ID to avoid conflict with shell's #root when running as a fragment
const rootElement = document.getElementById("plugin-health-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <HealthDashboard />
  </StrictMode>,
);

// Cleanup when fragment is unmounted
rootElement
  .getRootNode()
  .addEventListener("piercing-unmount", () => root.unmount(), { once: true });
