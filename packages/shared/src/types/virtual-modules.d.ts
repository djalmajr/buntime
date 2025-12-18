/**
 * Type declarations for virtual modules used by Bun plugins.
 * These are shared across all client apps (cpanel, plugins, etc).
 *
 * To use in a project, add to tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "types": ["@buntime/shared/types/virtual-modules"]
 *   }
 * }
 *
 * Or reference directly:
 * /// <reference types="@buntime/shared/types/virtual-modules" />
 */

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
