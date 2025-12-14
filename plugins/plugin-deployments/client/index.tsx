import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { Toaster } from "sonner";
import { DeploymentsPage } from "./components/deployments-page";
import en from "./locales/en.json";
import pt from "./locales/pt.json";

// Initialize i18n
i18n.use(initReactI18next).init({
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  lng: navigator.language.startsWith("pt") ? "pt" : "en",
  resources: {
    en: { deployments: en },
    pt: { deployments: pt },
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
  },
});

// Use a unique ID to avoid conflict with shell's #root when running as a fragment
const rootElement = document.getElementById("plugin-deployments-root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DeploymentsPage />
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  </StrictMode>,
);
