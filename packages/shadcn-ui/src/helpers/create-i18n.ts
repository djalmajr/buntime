import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

export const LANGUAGE_STORAGE_KEY = "tmwork:language";

type TranslationLoader = () => Promise<{ default: Record<string, unknown> }>;
type TranslationsMap = Record<string, Record<string, TranslationLoader>>;

export interface CreateI18nOptions {
  defaultNS?: string;
  fallbackLng?: string;
  storageKey?: string;
  supportedLngs?: string[];
  translations: TranslationsMap;
  useSuspense?: boolean;
}

export function createI18n({
  defaultNS = "common",
  fallbackLng = "en",
  storageKey = LANGUAGE_STORAGE_KEY,
  supportedLngs = ["pt", "en"],
  translations,
  useSuspense = true,
}: CreateI18nOptions) {
  i18n
    .use(
      resourcesToBackend((lng: string, ns: string) => {
        const nsTranslations = translations[ns];
        if (!nsTranslations) {
          return Promise.reject(new Error(`Namespace not found: ${ns}`));
        }
        const loader = nsTranslations[lng];
        if (!loader) {
          return Promise.reject(new Error(`Translation not found: ${ns}/${lng}`));
        }
        return loader();
      }),
    )
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      defaultNS,
      detection: {
        caches: ["localStorage"],
        convertDetectedLanguage: (lng: string) => lng.split("-")[0] ?? lng,
        lookupLocalStorage: storageKey,
        order: ["localStorage", "navigator"],
      },
      fallbackLng,
      interpolation: { escapeValue: false },
      react: { useSuspense },
      supportedLngs,
    });

  return i18n;
}
