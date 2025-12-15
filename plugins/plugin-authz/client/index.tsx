import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthzPage } from "./components/authz-page";

// Use a unique ID to avoid conflict with shell's #root when running as a fragment
const rootElement = document.getElementById("plugin-authz-root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <AuthzPage />
  </StrictMode>,
);
