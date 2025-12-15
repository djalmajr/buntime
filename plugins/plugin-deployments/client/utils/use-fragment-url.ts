import { dispatch, subscribe } from "@buntime/piercing/client";
import { useCallback, useEffect, useState } from "react";

/**
 * Get the shell's base path (for URL navigation).
 * This is different from getBasePath() which returns the fragment's base path.
 */
function getShellBasePath(): string {
  // Use the document's <base> tag which points to the shell's base path
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }
  return "";
}

interface ShellUrlChange {
  pathname: string;
  search: string;
}

interface UrlPathState {
  path: string;
  selectedRoot: string;
}

export function useFragmentUrl(rootDirs: string[]) {
  const [state, setState] = useState<UrlPathState>(() => parseUrlPath(rootDirs));

  // Listen for URL changes from shell (back/forward, direct navigation)
  useEffect(() => {
    return subscribe("shell:url-change", (event: unknown) => {
      const { pathname } = event as ShellUrlChange;
      const parsed = parsePathname(pathname, rootDirs);
      setState(parsed);
    });
  }, [rootDirs]);

  // Intercept history changes (for sidebar submenu navigation)
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

  // Set initial root when rootDirs loads
  useEffect(() => {
    if (rootDirs.length > 0 && !state.selectedRoot) {
      const parsed = parseUrlPath(rootDirs);
      if (parsed.selectedRoot) {
        setState(parsed);
      } else {
        // Default to first root and navigate
        const newState = { selectedRoot: rootDirs[0]!, path: "" };
        setState(newState);
        navigateToShell(newState);
      }
    }
  }, [rootDirs, state.selectedRoot]);

  const setPath = useCallback((newPath: string) => {
    setState((prev) => {
      const newState = { ...prev, path: newPath };
      navigateToShell(newState);
      return newState;
    });
  }, []);

  return { ...state, setPath };
}

function parseUrlPath(rootDirs: string[]): UrlPathState {
  return parsePathname(window.location.pathname, rootDirs);
}

function parsePathname(pathname: string, rootDirs: string[]): UrlPathState {
  const basePath = getShellBasePath();

  // Remove base path to get the deployment path
  let deployPath = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;

  // Remove leading slash
  deployPath = deployPath.replace(/^\/+/, "");

  // Remove "deployments/" prefix if present (this fragment's route in shell)
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

function navigateToShell(state: UrlPathState) {
  // Build URL relative to shell's basePath (TanStack Router adds basePath automatically)
  const url = state.path
    ? `/deployments/${state.selectedRoot}/${state.path}`
    : `/deployments/${state.selectedRoot}`;

  dispatch("fragment:navigate", {
    action: "push",
    fragmentId: "deployments",
    url,
  });
}
