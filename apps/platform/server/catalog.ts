import type { CatalogApp } from "./types.ts";

/** The admin tenant slug — its catalog exposes the platform control plane itself. */
export const ADMIN_SLUG = "admin";

/**
 * Default catalog for a tenant when none is supplied. The admin tenant sees the
 * platform UI (tenant management); every other tenant sees the example app.
 * Example/stub catalog — real per-tenant catalogs are out of scope.
 */
export function defaultCatalog(slug: string): CatalogApp[] {
  if (slug === ADMIN_SLUG) {
    return [{ name: "Platform", url: "/platform/", icon: "lucide:layout-dashboard" }];
  }
  return [{ name: "Todos", url: "/todos/", icon: "lucide:check-square" }];
}
