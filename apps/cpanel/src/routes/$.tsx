import { createFileRoute, notFound, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { BUNTIME_URL } from "~/helpers/config";

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

function FragmentRouter() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const frameRef = useRef<HTMLElement>(null);
  const segment = getSegment(pathname);

  // Update pathname prop on the frame when route changes
  useEffect(() => {
    const frame = frameRef.current;
    if (frame && segment) {
      (frame as any).pathname = getFramePathname(pathname, segment);
    }
  }, [pathname, segment]);

  // Listen for frame events
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const handleNavigate = (event: Event) => {
      const { path, replace } = (event as CustomEvent<FrameNavigateDetail>).detail;
      navigate({ to: path, replace });
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
  }, [navigate]);

  if (!segment) {
    throw notFound();
  }

  return (
    <z-frame
      ref={frameRef}
      base={`/${segment}`}
      src={`${BUNTIME_URL}/${segment}`}
      pathname={getFramePathname(pathname, segment)}
    />
  );
}

export const Route = createFileRoute("/$")({
  component: FragmentRouter,
});
