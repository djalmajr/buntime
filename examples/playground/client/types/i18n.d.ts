declare module "virtual:i18n" {
  type TranslationLoader = () => Promise<{ default: Record<string, unknown> }>;
  export const translations: Record<string, Record<string, TranslationLoader>>;
}
