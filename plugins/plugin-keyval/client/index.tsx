import i18n from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { KeyvalPage } from "./components/keyval-page";
import en from "./locales/en.json";
import pt from "./locales/pt.json";

i18n.use(initReactI18next).init({
  debug: false,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  lng: "en",
  resources: {
    en: { translation: en },
    pt: { translation: pt },
  },
});

const rootElement = document.getElementById("plugin-keyval-root");
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <KeyvalPage />
  </StrictMode>,
);

// Cleanup when fragment is unmounted
rootElement
  .getRootNode()
  .addEventListener("piercing-unmount", () => root.unmount(), { once: true });
