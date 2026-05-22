import { createFileRoute, notFound, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useHeader } from "~/contexts/header-context";
import { usePlugins } from "~/hooks/use-plugins";
import type { ZFrameAttributes } from "~/types/frame";

/** Sandbox permissions for plugin iframes (includes allow-downloads for file downloads) */
const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads";

/**
 * Extract segment (plugin name) from path
 * e.g., "/metrics" -> "metrics", "/metrics/workers" -> "metrics"
 */
function getSegment(path: string): string | undefined {
  const match = path.match(/^\/([^/]+)/);
  return match?.[1];
}

/**
 * Extract pathname relative to frame base
 * Ex: pathname="/deployments/apps/foo" + segment="deployments" -> "/apps/foo"
 */
function getFramePathname(pathname: string, segment: string): string {
  const basePath = `/${segment}`;
  if (pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }
  return "/";
}

interface FrameErrorDetail {
  message: string;
  status?: number;
}

interface FrameNavigateDetail {
  path: string;
  replace?: boolean;
}

/**
 * Resolve a human-readable title for the current plugin route from the
 * loaded plugins' menu metadata. Falls back to the segment in title case so
 * the cpanel shell always shows *something* in the breadcrumb area.
 */
function usePluginPageTitle(segment: string | undefined): string {
  const { t } = useTranslation();
  const plugins$ = usePlugins();

  return useMemo(() => {
    if (!segment) return "";
    const basePath = `/${segment}`;
    const allMenus = (plugins$.data ?? []).flatMap((p) => p.menus ?? []);
    const top = allMenus.find((m) => m.path === basePath);
    if (top) return top.title.includes(":") ? t(top.title) : top.title;
    // Fallback: segment with first letter uppercased.
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  }, [plugins$.data, segment, t]);
}

function FragmentRouter() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const frameRef = useRef<HTMLElement>(null);
  const segment = getSegment(pathname);
  const { setHeader } = useHeader();
  const pageTitle = usePluginPageTitle(segment);

  // Use ref to always have current segment value in event handler (avoids stale closure)
  const segmentRef = useRef(segment);
  segmentRef.current = segment;

  // Publish the page title to the cpanel shell so `DefaultHeader` renders a
  // breadcrumb like the runtime sections (Keys/Workers/Plugins/Overview).
  // Without this, plugin iframes would render flush against the sidebar with
  // no shell-level header — inconsistent with the rest of the UI.
  useEffect(() => {
    if (pageTitle) {
      setHeader({ title: pageTitle });
    } else {
      setHeader(null);
    }
    return () => setHeader(null);
  }, [pageTitle, setHeader]);

  // Update pathname prop and emit route-change event when route changes
  useEffect(() => {
    const frame = frameRef.current as HTMLElement & ZFrameAttributes;
    if (frame && segment) {
      const framePath = getFramePathname(pathname, segment);
      frame.pathname = framePath;
      frame.emit?.("route-change", { path: framePath });
    }
  }, [pathname, segment]);

  // Listen for frame events - only re-attach when frame changes, not segment
  // Use segmentRef to always get current segment value
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const handleNavigate = (event: Event) => {
      const currentSegment = segmentRef.current;
      if (!currentSegment) return;

      const { path, replace } = (event as CustomEvent<FrameNavigateDetail>).detail;
      // Frame emits relative path, shell needs full path with segment prefix
      const fullPath = `/${currentSegment}${path.startsWith("/") ? path : `/${path}`}`;
      navigate({ to: fullPath, replace });
    };

    const handleError = (event: Event) => {
      const { message, status } = (event as CustomEvent<FrameErrorDetail>).detail;
      const title = status === 403 ? "Access Denied" : "Failed to load";
      toast.error(title, {
        description: message,
        duration: 5000,
      });
    };

    frame.addEventListener("navigate", handleNavigate);
    frame.addEventListener("error", handleError);

    return () => {
      frame.removeEventListener("navigate", handleNavigate);
      frame.removeEventListener("error", handleError);
    };
  }, [navigate]); // Removed segment from deps - use segmentRef instead

  if (!segment) {
    throw notFound();
  }

  // The outer `<Outlet>` wrapper in __root.tsx already provides `p-4` padding;
  // we just need the iframe to fill the remaining flex area.
  return (
    <div className="flex flex-1 flex-col">
      <z-frame
        ref={frameRef}
        src={`${location.origin}/${segment}`}
        pathname={getFramePathname(pathname, segment)}
        sandbox={FRAME_SANDBOX}
        style={{ display: "flex", flex: 1, height: "100%", width: "100%" }}
      />
    </div>
  );
}

export const Route = createFileRoute("/$")({
  component: FragmentRouter,
});
