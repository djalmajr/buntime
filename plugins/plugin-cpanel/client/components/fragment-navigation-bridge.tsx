import { dispatch, subscribe } from "@buntime/piercing/client";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

interface FragmentNavigateEvent {
  action: "push" | "replace" | "pop";
  fragmentId: string;
  state?: unknown;
  url: string;
}

/**
 * Bridge between fragment navigation events and shell router
 * Place this in the root layout to handle all fragment navigation
 */
export function FragmentNavigationBridge() {
  const navigate = useNavigate();
  const routerState = useRouterState();

  // Listen for fragment navigation events
  useEffect(() => {
    return subscribe("fragment:navigate", (event: unknown) => {
      const { action, url } = event as FragmentNavigateEvent;
      navigate({
        replace: action === "replace",
        to: url,
      });
    });
  }, [navigate]);

  // Dispatch URL changes to fragments
  useEffect(() => {
    dispatch("shell:url-change", {
      pathname: routerState.location.pathname,
      search: routerState.location.search,
    });
  }, [routerState.location.pathname, routerState.location.search]);

  return null;
}
