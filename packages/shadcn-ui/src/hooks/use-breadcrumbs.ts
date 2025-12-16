import { useLocation, useMatches } from "@tanstack/react-router";
import { uniq } from "es-toolkit";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MainLayoutBreadcrumb } from "../components/layouts/main-layout";

type BreadcrumbLabel = string | [string, Record<string, unknown>?];

interface I18nInstance {
  hasLoadedNamespace: (ns: string) => boolean;
  loadNamespaces: (ns: string[]) => Promise<void>;
}

interface UseBreadcrumbsOptions {
  /** i18n instance for loading namespaces dynamically */
  i18n: I18nInstance;
  /** Optional path-to-label mapping for simple static breadcrumbs */
  pathLabels?: Record<string, string>;
}

/**
 * Hook to generate breadcrumbs from route data.
 *
 * Supports two modes:
 * 1. **loaderData mode** (default): Reads breadcrumb from route loaderData.breadcrumb
 * 2. **pathLabels mode**: Uses a static path-to-label mapping
 *
 * @example
 * // loaderData mode - reads from route loaderData.breadcrumb
 * const breadcrumbs = useBreadcrumbs({ i18n });
 *
 * @example
 * // pathLabels mode - static mapping
 * const breadcrumbs = useBreadcrumbs({
 *   i18n,
 *   pathLabels: { "/": "nav.dashboard", "/targets": "nav.targets" }
 * });
 */
export function useBreadcrumbs({
  i18n,
  pathLabels,
}: UseBreadcrumbsOptions): MainLayoutBreadcrumb[] {
  const matches = useMatches();
  const location = useLocation();
  const { t } = useTranslation();
  const [nsLoaded, setNSLoaded] = useState(false);

  // Build breadcrumb data based on mode
  const breadcrumbData = useMemo(() => {
    // pathLabels mode: simple static mapping
    if (pathLabels) {
      const label = pathLabels[location.pathname];
      if (!label) return [];
      return [{ label, path: location.pathname }];
    }

    // loaderData mode: read from route loaderData.breadcrumb
    return matches
      .filter((match) => match.loaderData?.breadcrumb)
      .map((match) => ({
        label: match.loaderData!.breadcrumb as BreadcrumbLabel,
        path: match.pathname,
      }));
  }, [matches, location.pathname, pathLabels]);

  // Extract required namespaces
  const requiredNamespaces = useMemo(() => {
    const ns = breadcrumbData
      .map((bc) => {
        const key = Array.isArray(bc.label) ? bc.label[0] : bc.label;
        if (typeof key === "string" && key.includes(":")) {
          const namespace = key.split(":")[0];
          return namespace !== "common" ? namespace : null;
        }
        return null;
      })
      .filter((n): n is string => n !== null);

    return uniq(ns);
  }, [breadcrumbData]);

  // Check if all required namespaces are loaded
  const allNamespacesReady = requiredNamespaces.every((ns) => i18n.hasLoadedNamespace(ns));

  // Load required namespaces
  useEffect(() => {
    if (requiredNamespaces.length > 0 && !allNamespacesReady) {
      i18n.loadNamespaces(requiredNamespaces).then(() => {
        setNSLoaded(true);
      });
    } else {
      setNSLoaded(true);
    }
  }, [requiredNamespaces, allNamespacesReady, i18n]);

  // Return empty array until namespaces are loaded to avoid showing translation keys
  if (!allNamespacesReady && !nsLoaded) {
    return [];
  }

  return breadcrumbData.map((bc, index, arr) => {
    const label = Array.isArray(bc.label) ? t(...bc.label) : t(bc.label);
    const isLast = index === arr.length - 1;

    return {
      href: isLast ? undefined : bc.path,
      label,
    };
  });
}
