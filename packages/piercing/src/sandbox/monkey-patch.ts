import { dispatch, getBus } from "../message-bus/client-message-bus";
import type { JSONValue } from "../types";
import type { SandboxConfig, SandboxNavigateEvent, SandboxStrategyHandler } from "./types";

/**
 * Monkey-patch sandbox strategy
 *
 * Intercepts History API calls and link clicks to prevent
 * fragments from changing the browser URL.
 *
 * Also bridges the fragment client SDK with the shell's MessageBus:
 * - Initializes window.__PIERCING_STATE__ with current state
 * - Forwards piercing:dispatch events to MessageBus
 * - Forwards piercing:navigate events to shell
 * - Dispatches piercing:state events on state changes
 *
 * Best for: Internal plugins that need routing isolation
 * Pros: Lightweight, shares DOM/styles with shell
 * Cons: Not fully isolated, fragment scripts still run in main context
 */
export function createMonkeyPatchSandbox(config: SandboxConfig): SandboxStrategyHandler {
  const { fragmentId, mountPath, allowMessageBus = true } = config;

  // Store original methods
  let originalPushState: typeof history.pushState;
  let originalReplaceState: typeof history.replaceState;
  let clickHandler: ((e: MouseEvent) => void) | null = null;
  let popstateHandler: ((e: PopStateEvent) => void) | null = null;

  // Client SDK bridge handlers
  let clientDispatchHandler: ((e: Event) => void) | null = null;
  let clientNavigateHandler: ((e: Event) => void) | null = null;
  let messageBusCleanup: (() => void) | null = null;

  function rewriteUrl(url: string | URL | null | undefined): string {
    if (!url) return mountPath;
    const urlStr = url.toString();
    if (urlStr.startsWith("http")) return urlStr;
    if (urlStr.startsWith("/")) return `${mountPath}${urlStr}`;
    return `${mountPath}/${urlStr}`;
  }

  function emitNavigate(event: SandboxNavigateEvent): void {
    if (allowMessageBus) {
      dispatch("fragment:navigate", event);
    }
  }

  return {
    init() {
      // Save originals
      originalPushState = history.pushState.bind(history);
      originalReplaceState = history.replaceState.bind(history);

      // Intercept pushState
      history.pushState = function (state, _title, url) {
        const rewrittenUrl = rewriteUrl(url);
        emitNavigate({
          action: "push",
          fragmentId,
          state: (state ?? null) as JSONValue,
          url: rewrittenUrl,
        });
        // Don't call original - shell handles URL changes
      };

      // Intercept replaceState
      history.replaceState = function (state, _title, url) {
        const rewrittenUrl = rewriteUrl(url);
        emitNavigate({
          action: "replace",
          fragmentId,
          state: (state ?? null) as JSONValue,
          url: rewrittenUrl,
        });
      };

      // Intercept link clicks
      clickHandler = (e: MouseEvent) => {
        const link = (e.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!link) return;

        const href = link.getAttribute("href");
        if (!href) return;

        // Allow external links
        if (href.startsWith("http") || href.startsWith("//")) return;
        // Allow hash-only links
        if (href.startsWith("#")) return;
        // Allow download links
        if (link.hasAttribute("download")) return;
        // Allow target="_blank"
        if (link.target === "_blank") return;

        e.preventDefault();
        e.stopPropagation();

        const rewrittenUrl = rewriteUrl(href);
        emitNavigate({
          action: "push",
          fragmentId,
          state: null,
          url: rewrittenUrl,
        });
      };

      document.addEventListener("click", clickHandler, true);

      // Intercept popstate (back/forward)
      popstateHandler = (e: PopStateEvent) => {
        emitNavigate({
          action: "pop",
          fragmentId,
          state: (e.state ?? null) as JSONValue,
          url: window.location.pathname,
        });
      };

      window.addEventListener("popstate", popstateHandler);

      // === Client SDK Bridge ===
      if (allowMessageBus) {
        const bus = getBus();

        // Initialize global state for client SDK
        window.__PIERCING_STATE__ = bus.state;

        // Dispatch initial state event
        window.dispatchEvent(new CustomEvent("piercing:state", { detail: bus.state }));

        // Listen for dispatch events from client SDK
        clientDispatchHandler = (e: Event) => {
          const { eventName, payload } = (
            e as CustomEvent<{ eventName: string; payload: JSONValue }>
          ).detail;
          dispatch(eventName, payload);
        };
        window.addEventListener("piercing:dispatch", clientDispatchHandler);

        // Listen for navigate events from client SDK
        clientNavigateHandler = (e: Event) => {
          const { action, url, state } = (
            e as CustomEvent<{ action: string; url: string; state: JSONValue }>
          ).detail;
          const rewrittenUrl = rewriteUrl(url);
          emitNavigate({
            action: action as "push" | "replace",
            fragmentId,
            state: state ?? null,
            url: rewrittenUrl,
          });
        };
        window.addEventListener("piercing:navigate", clientNavigateHandler);

        // Listen for all MessageBus events and forward to client SDK
        // This creates a wildcard listener that forwards events as piercing:event
        messageBusCleanup = bus.listen("*", ((value: JSONValue, eventName: string) => {
          // Update global state
          window.__PIERCING_STATE__ = bus.state;

          // Dispatch state change event
          window.dispatchEvent(new CustomEvent("piercing:state", { detail: bus.state }));

          // Dispatch specific event
          window.dispatchEvent(
            new CustomEvent("piercing:event", {
              detail: { name: eventName, payload: value },
            }),
          );
        }) as (value: JSONValue) => void);
      }

      console.log(`[Piercing] Monkey-patch sandbox activated for: ${fragmentId}`);
    },

    cleanup() {
      // Restore originals
      if (originalPushState) {
        history.pushState = originalPushState;
      }
      if (originalReplaceState) {
        history.replaceState = originalReplaceState;
      }

      // Remove navigation listeners
      if (clickHandler) {
        document.removeEventListener("click", clickHandler, true);
        clickHandler = null;
      }
      if (popstateHandler) {
        window.removeEventListener("popstate", popstateHandler);
        popstateHandler = null;
      }

      // Remove client SDK bridge listeners
      if (clientDispatchHandler) {
        window.removeEventListener("piercing:dispatch", clientDispatchHandler);
        clientDispatchHandler = null;
      }
      if (clientNavigateHandler) {
        window.removeEventListener("piercing:navigate", clientNavigateHandler);
        clientNavigateHandler = null;
      }
      if (messageBusCleanup) {
        messageBusCleanup();
        messageBusCleanup = null;
      }

      console.log(`[Piercing] Monkey-patch sandbox deactivated for: ${fragmentId}`);
    },
  };
}
