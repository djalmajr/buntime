import { useEffect, useState } from "react";
import { MetricsView } from "./metrics-view";
import { WorkersView } from "./workers-view";

function getFragmentUrl(): string {
  const pathname = window.location.pathname;
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  const basePath = baseHref.replace(/\/$/, "");

  if (basePath && pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }

  return pathname;
}

export function MetricsPage() {
  const [currentPath, setCurrentPath] = useState(getFragmentUrl());

  useEffect(() => {
    const updatePath = () => {
      const url = getFragmentUrl();
      setCurrentPath(url);
    };

    // Listen for browser back/forward navigation
    window.addEventListener("popstate", updatePath);

    // Intercept pushState/replaceState to detect programmatic navigation
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      originalPushState(...args);
      updatePath();
    };

    history.replaceState = (...args) => {
      originalReplaceState(...args);
      updatePath();
    };

    return () => {
      window.removeEventListener("popstate", updatePath);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, []);

  if (currentPath.startsWith("/metrics/workers")) {
    return <WorkersView />;
  }

  // Default: Overview (/, /metrics, or any other path)
  return <MetricsView />;
}
