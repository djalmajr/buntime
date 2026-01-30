import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LogsTable } from "./components/logs-table";

// Use a unique ID to avoid conflict with shell's #root when running as a fragment
const rootElement = document.getElementById("plugin-logs-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <LogsTable />
  </StrictMode>,
);
