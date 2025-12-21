import { translations } from "virtual:i18n";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

type TranslationLoader = () => Promise<{ default: Record<string, unknown> }>;
type TranslationsMap = Record<string, Record<string, TranslationLoader>>;

i18n
  .use(
    resourcesToBackend((lng: string, ns: string) => {
      const nsTranslations = (translations as TranslationsMap)[ns];
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
    defaultNS: "common",
    detection: {
      caches: ["localStorage"],
      lookupLocalStorage: "docs:language",
      order: ["localStorage", "navigator"],
    },
    fallbackLng: "pt",
    interpolation: { escapeValue: false },
    ns: ["common"],
    nonExplicitSupportedLngs: true,
    partialBundledLanguages: true,
    react: { useSuspense: false },
    supportedLngs: ["en", "es", "pt"],
  });

export default i18n;
