import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HealthDashboard } from "./components/health-dashboard";

// Use a unique ID to avoid conflict with shell's #root when running as a fragment
const rootElement = document.getElementById("plugin-health-root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <HealthDashboard />
  </StrictMode>,
);
