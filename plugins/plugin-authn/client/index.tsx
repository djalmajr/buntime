import { createRoot } from "react-dom/client";
import { App } from "./app";

const rootElement = document.getElementById("plugin-authn-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(<App />);

// Cleanup when fragment is unmounted
rootElement
  .getRootNode()
  .addEventListener("piercing-unmount", () => root.unmount(), { once: true });
