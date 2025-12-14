import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HealthDashboard } from "./components/health-dashboard";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <HealthDashboard />
  </StrictMode>,
);
