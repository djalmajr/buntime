import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GatewayPage } from "./components/gateway-page";

const rootElement = document.getElementById("plugin-gateway-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <GatewayPage />
  </StrictMode>,
);
