import i18next from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { DurablePage } from "./components/durable-page";

import en from "./locales/en.json";
import pt from "./locales/pt.json";

i18next.use(initReactI18next).init({
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  lng: "en",
  resources: {
    en: { durable: en },
    pt: { durable: pt },
  },
});

const rootElement = document.getElementById("plugin-durable-root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18next}>
      <DurablePage />
    </I18nextProvider>
  </StrictMode>,
);
