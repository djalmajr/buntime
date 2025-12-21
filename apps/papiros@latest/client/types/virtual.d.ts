declare module "virtual:icons" {
  interface IconData {
    body: string;
    height: number;
    width: number;
  }

  export const registry: Record<string, IconData>;
}

declare module "virtual:i18n" {
  type TranslationLoader = () => Promise<{ default: Record<string, unknown> }>;
  export const translations: Record<string, Record<string, TranslationLoader>>;
}

interface Window {
  mermaid?: {
    initialize: (config: Record<string, unknown>) => void;
    run: (config: { querySelector: string }) => Promise<void>;
  };
}
