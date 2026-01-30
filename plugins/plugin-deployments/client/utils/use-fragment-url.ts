import { useCallback, useEffect, useState } from "react";
import { useFrameSDK } from "./use-frame-sdk";

interface UrlPathState {
  path: string;
  selectedRoot: string;
}

/**
 * Hook for managing deployment URL state.
 * Syncs with parent shell via Frame SDK when running in iframe.
 */
export function useFragmentUrl(rootDirs: string[]) {
  const { props, emit, sdkAvailable } = useFrameSDK<{ pathname?: string }>();
  const [state, setState] = useState<UrlPathState>(() => parseUrlPath(rootDirs));

  // Watch for pathname changes from shell (via Frame SDK props)
  useEffect(() => {
    if (!sdkAvailable || !props.pathname) return;

    const parsed = parsePathname(props.pathname, rootDirs);
    setState(parsed);
  }, [props.pathname, rootDirs, sdkAvailable]);

  // Intercept history changes (for standalone mode or internal navigation)
  useEffect(() => {
    const updateFromUrl = () => {
      const parsed = parseUrlPath(rootDirs);
      setState(parsed);
    };

    // Listen for browser back/forward navigation
    window.addEventListener("popstate", updateFromUrl);

    // Intercept pushState/replaceState to detect programmatic navigation
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = (...args) => {
      originalPushState(...args);
      updateFromUrl();
    };

    history.replaceState = (...args) => {
      originalReplaceState(...args);
      updateFromUrl();
    };

    return () => {
      window.removeEventListener("popstate", updateFromUrl);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, [rootDirs]);

  // Set initial root when rootDirs loads and redirect to first workerDir
  useEffect(() => {
    if (rootDirs.length === 0) return;

    const parsed = parseUrlPath(rootDirs);

    // Check if URL needs updating (no workerDir in URL but we have workerDirs)
    const currentPath = window.location.pathname;
    const needsRedirect =
      currentPath === "/" ||
      currentPath === "/deployments" ||
      currentPath === "/deployments/" ||
      !parsed.selectedRoot;

    if (needsRedirect && rootDirs[0]) {
      // Redirect to first workerDir
      const newState = { selectedRoot: rootDirs[0], path: "" };
      setState(newState);
      navigateToPath(newState, emit);
    } else if (parsed.selectedRoot && parsed.selectedRoot !== state.selectedRoot) {
      setState(parsed);
    }
  }, [rootDirs, state.selectedRoot, emit]);

  const setPath = useCallback(
    (newPath: string) => {
      setState((prev) => {
        const newState = { ...prev, path: newPath };
        navigateToPath(newState, emit);
        return newState;
      });
    },
    [emit],
  );

  return { ...state, setPath };
}

function parseUrlPath(rootDirs: string[]): UrlPathState {
  return parsePathname(window.location.pathname, rootDirs);
}

function parsePathname(pathname: string, rootDirs: string[]): UrlPathState {
  // Remove leading slash
  let deployPath = pathname.replace(/^\/+/, "");

  // Remove "deployments/" prefix if present
  if (deployPath.startsWith("deployments/")) {
    deployPath = deployPath.slice("deployments/".length);
  } else if (deployPath === "deployments") {
    deployPath = "";
  }

  if (!deployPath) {
    return { selectedRoot: rootDirs[0] || "", path: "" };
  }

  // First segment is the root
  const segments = deployPath.split("/");
  const selectedRoot = segments[0] || "";
  const path = segments.slice(1).join("/");

  // Validate root exists
  if (rootDirs.length > 0 && !rootDirs.includes(selectedRoot)) {
    return { selectedRoot: rootDirs[0] || "", path: "" };
  }

  return { selectedRoot, path };
}

function navigateToPath(state: UrlPathState, emit: (event: string, data?: unknown) => void) {
  // Build URL path
  const url = state.path ? `/${state.selectedRoot}/${state.path}` : `/${state.selectedRoot}`;

  // Emit navigation event to shell (Frame SDK)
  emit("navigate", { path: url, replace: false, state: {} });

  // Also update local history for standalone mode
  const fullPath = `/deployments${url}`;
  if (window.location.pathname !== fullPath) {
    history.pushState({}, "", fullPath);
  }
}
