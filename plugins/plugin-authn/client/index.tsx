import { registry } from "virtual:icons";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { IconProvider } from "./components/ui/icon";

const rootElement = document.getElementById("plugin-authn-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <IconProvider registry={registry}>
      <App />
    </IconProvider>
  </StrictMode>,
);
