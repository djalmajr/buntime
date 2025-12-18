import { createFileRoute, notFound, useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Mapeia primeiro segmento do path para breadcrumb i18n key
const BREADCRUMB_MAP: Record<string, string> = {
  authz: "authz:nav.authz",
  database: "common:nav.database",
  deployments: "common:nav.deployments",
  durable: "common:nav.durable",
  gateway: "common:nav.gateway",
  health: "common:nav.health",
  keyval: "common:nav.keyval",
  logs: "common:nav.logs",
  metrics: "common:nav.metrics",
};

/**
 * Get shell base from <base> tag
 */
function getShellBase(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "";
}

/**
 * Extract segment (plugin name) from path
 * e.g., "/metrics" -> "metrics", "/metrics/workers" -> "metrics"
 */
function getSegment(path: string): string | undefined {
  const match = path.match(/^\/([^/]+)/);
  return match?.[1];
}

/**
 * Calculate the fragment's base path for TanStack Router
 * e.g., shellBase="/cpanel", segment="database" -> "/cpanel/database"
 */
function getFragmentBase(shellBase: string, segment: string): string {
  return `${shellBase}/${segment}`;
}

interface PiercingErrorDetail {
  error: string;
  policy?: string;
  reason?: string;
  status: number;
  url: string;
}

function FragmentRouter() {
  // pathname is relative to cpanel's basepath (e.g., /metrics, /database/studio)
  const { pathname } = useLocation();
  const outletRef = useRef<HTMLElement>(null);
  const shellBase = getShellBase();
  const segment = getSegment(pathname);

  // Listen for fragment load errors
  useEffect(() => {
    const outlet = outletRef.current;
    if (!outlet) return;

    const handleError = (event: Event) => {
      const { detail } = event as CustomEvent<PiercingErrorDetail>;

      // Show error toast with details
      const title = detail.status === 403 ? "Access Denied" : "Failed to load fragment";
      const description = detail.reason || detail.error || `HTTP ${detail.status}`;

      toast.error(title, {
        description,
        duration: 5000,
      });
    };

    outlet.addEventListener("piercing-error", handleError);
    return () => outlet.removeEventListener("piercing-error", handleError);
  }, []);

  if (!segment || !BREADCRUMB_MAP[segment]) {
    throw notFound();
  }

  // src: URL to fetch the fragment from (just the segment, e.g., /metrics)
  // base: Router basepath for the fragment (e.g., /cpanel/metrics)
  // Fragment's internal router handles sub-routes by reading window.location
  const fragmentBase = getFragmentBase(shellBase, segment);

  return <fragment-outlet ref={outletRef} base={fragmentBase} src={`/${segment}`} />;
}

export const Route = createFileRoute("/$")({
  component: FragmentRouter,
  loader: ({ params }) => {
    // _splat contains the path after the basepath (e.g., "metrics" or "database/studio")
    const segment = params._splat?.split("/")[0] ?? "";
    return { breadcrumb: BREADCRUMB_MAP[segment] ?? segment };
  },
});
