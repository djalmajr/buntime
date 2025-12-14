import { dispatch, getBus } from "../message-bus/client-message-bus";
import type { JSONValue } from "../types";
import type { SandboxConfig, SandboxNavigateEvent, SandboxStrategyHandler } from "./types";

/**
 * Iframe sandbox strategy
 *
 * Renders the fragment in an isolated iframe for complete separation.
 * Communication happens via postMessage.
 *
 * Best for: Untrusted external apps, legacy apps with global pollution
 * Pros: Full JS/DOM isolation, secure
 * Cons: No shared styles, limited communication, iframe quirks
 */
export function createIframeSandbox(
  config: SandboxConfig,
  container: HTMLElement,
): SandboxStrategyHandler {
  const { fragmentId, origin, mountPath, allowMessageBus = true, preloadStyles } = config;

  if (!origin) {
    throw new Error(`Iframe sandbox requires "origin" for fragment "${fragmentId}"`);
  }

  let iframe: HTMLIFrameElement | null = null;
  let messageHandler: ((e: MessageEvent) => void) | null = null;

  function emitNavigate(event: SandboxNavigateEvent): void {
    if (allowMessageBus) {
      dispatch("fragment:navigate", event);
    }
  }

  return {
    init() {
      // Create iframe
      iframe = document.createElement("iframe");
      iframe.src = origin;
      iframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
        display: block;
      `;

      // Security attributes
      iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
      iframe.setAttribute("loading", "lazy");

      // Inject preload styles into container (for loading state)
      if (preloadStyles) {
        const style = document.createElement("style");
        style.textContent = preloadStyles;
        container.appendChild(style);
      }

      // Listen for messages from iframe
      messageHandler = (e: MessageEvent) => {
        // Verify origin
        if (e.origin !== new URL(origin).origin) return;

        const { type, payload } = e.data || {};

        switch (type) {
          case "PIERCING_NAVIGATE":
            emitNavigate({
              action: payload.action,
              fragmentId,
              state: (payload.state ?? null) as JSONValue,
              url: `${mountPath}${payload.url}`,
            });
            break;

          case "PIERCING_DISPATCH":
            // Forward MessageBus events from iframe
            if (allowMessageBus && payload.eventName && payload.value !== undefined) {
              dispatch(payload.eventName, payload.value);
            }
            break;

          case "PIERCING_READY":
            // Fragment loaded, send initial state
            iframe?.contentWindow?.postMessage(
              {
                type: "PIERCING_STATE",
                payload: getBus().state,
              },
              origin,
            );
            break;
        }
      };

      window.addEventListener("message", messageHandler);

      // Add iframe to container
      container.appendChild(iframe);

      console.log(`[Piercing] Iframe sandbox activated for: ${fragmentId}`);
    },

    cleanup() {
      if (messageHandler) {
        window.removeEventListener("message", messageHandler);
        messageHandler = null;
      }

      if (iframe) {
        iframe.remove();
        iframe = null;
      }

      console.log(`[Piercing] Iframe sandbox deactivated for: ${fragmentId}`);
    },

    onNavigate(event: SandboxNavigateEvent) {
      // Forward navigation to iframe
      if (iframe?.contentWindow && origin) {
        iframe.contentWindow.postMessage(
          {
            type: "PIERCING_NAVIGATE",
            payload: {
              action: event.action,
              url: event.url.replace(mountPath, ""),
              state: event.state,
            },
          },
          origin,
        );
      }
    },
  };
}

/**
 * Client script to inject in iframe for communication with shell
 *
 * External apps should include this script to enable piercing features:
 *
 * ```html
 * <script src="/_piercing/iframe-client.js"></script>
 * ```
 *
 * After including, use the piercing client SDK:
 * ```typescript
 * import { getPiercingClient } from '@buntime/piercing/client';
 *
 * const piercing = getPiercingClient();
 * const user = piercing.state.user;
 *
 * piercing.onStateChange((state) => console.log('State:', state));
 * piercing.dispatch('myEvent', { data: 'value' });
 * ```
 */
export const IFRAME_CLIENT_SCRIPT = `
(function() {
  const shellOrigin = window.parent !== window ? document.referrer : null;
  if (!shellOrigin) return;

  // Initialize global state
  window.__PIERCING_STATE__ = window.__PIERCING_STATE__ || {};

  // Notify shell that we're ready
  window.parent.postMessage({ type: 'PIERCING_READY' }, shellOrigin);

  // Intercept History API
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function(state, title, url) {
    originalPushState(state, title, url);
    window.parent.postMessage({
      type: 'PIERCING_NAVIGATE',
      payload: { action: 'push', url: url?.toString() || '/', state }
    }, shellOrigin);
  };

  history.replaceState = function(state, title, url) {
    originalReplaceState(state, title, url);
    window.parent.postMessage({
      type: 'PIERCING_NAVIGATE',
      payload: { action: 'replace', url: url?.toString() || '/', state }
    }, shellOrigin);
  };

  // Listen for messages from shell
  window.addEventListener('message', function(e) {
    // State update from shell
    if (e.data?.type === 'PIERCING_STATE') {
      window.__PIERCING_STATE__ = e.data.payload;
      window.dispatchEvent(new CustomEvent('piercing:state', { detail: e.data.payload }));
    }

    // Navigation command from shell
    if (e.data?.type === 'PIERCING_NAVIGATE') {
      const { action, url, state } = e.data.payload;
      if (action === 'push') history.pushState(state, '', url);
      else if (action === 'replace') history.replaceState(state, '', url);
      else if (action === 'pop') history.back();
    }

    // Event from shell or other fragments
    if (e.data?.type === 'PIERCING_EVENT') {
      const { name, payload } = e.data.payload;
      window.dispatchEvent(new CustomEvent('piercing:event', { detail: { name, payload } }));
    }
  });

  // Listen for dispatch events from client SDK and forward to shell
  window.addEventListener('piercing:dispatch', function(e) {
    window.parent.postMessage({
      type: 'PIERCING_DISPATCH',
      payload: { eventName: e.detail.eventName, value: e.detail.payload }
    }, shellOrigin);
  });

  // Listen for navigate events from client SDK
  window.addEventListener('piercing:navigate', function(e) {
    const { action, url, state } = e.detail;
    window.parent.postMessage({
      type: 'PIERCING_NAVIGATE',
      payload: { action, url, state }
    }, shellOrigin);
  });

  console.log('[Piercing] Iframe client initialized');
})();
`;
