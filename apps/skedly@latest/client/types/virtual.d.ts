declare module "virtual:icons" {
  import type { IconifyIcon } from "@iconify-icon/react";
  export const registry: Record<string, IconifyIcon | IconifyIcon[]>;
}

declare module "virtual:i18n" {
  export const translations: Record<
    string,
    Record<string, () => Promise<{ default: Record<string, unknown> }>>
  >;
}
