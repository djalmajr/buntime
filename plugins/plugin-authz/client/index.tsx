import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthzPage } from "./components/authz-page";

// Use a unique ID to avoid conflict with shell's #root when running as a fragment
const rootElement = document.getElementById("plugin-authz-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <AuthzPage />
  </StrictMode>,
);

// Cleanup when fragment is unmounted
rootElement
  .getRootNode()
  .addEventListener("piercing-unmount", () => root.unmount(), { once: true });
