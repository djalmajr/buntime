import { dispatch } from "../message-bus/client-message-bus";
import type { SandboxConfig, SandboxStrategyHandler } from "./types";

/**
 * Service Worker sandbox strategy
 *
 * Registers fragment with a Service Worker that:
 * - Intercepts requests to the external origin
 * - Injects sandbox script into HTML responses
 * - Proxies assets while rewriting URLs
 *
 * Best for: External apps that need to share styles with shell
 * Pros: Shared DOM/styles, can modify responses
 * Cons: Requires SW support, more complex setup
 */

/** Registry of fragments managed by SW */
interface FragmentRegistry {
  fragmentId: string;
  origin: string;
  mountPath: string;
  allowMessageBus: boolean;
}

// Singleton for SW management
let swRegistration: ServiceWorkerRegistration | null = null;
let swReady = false;
const pendingFragments: FragmentRegistry[] = [];
const fragmentCleanups = new Map<string, () => void>();

/**
 * Initialize the piercing service worker
 * Call this once at app startup
 */
export async function initPiercingServiceWorker(swUrl = "/_piercing/sw.js"): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    console.warn("[Piercing] Service Worker not supported");
    return false;
  }

  try {
    swRegistration = await navigator.serviceWorker.register(swUrl, { scope: "/" });
    await navigator.serviceWorker.ready;
    swReady = true;

    // Register any pending fragments
    for (const fragment of pendingFragments) {
      registerFragmentWithSW(fragment);
    }
    pendingFragments.length = 0;

    // Listen for navigation events from SW
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "PIERCING_NAVIGATE") {
        const { fragmentId, action, url, state } = event.data.payload;
        dispatch("fragment:navigate", { fragmentId, action, url, state });
      }
    });

    console.log("[Piercing] Service Worker initialized");
    return true;
  } catch (err) {
    console.error("[Piercing] Failed to register Service Worker:", err);
    return false;
  }
}

function registerFragmentWithSW(fragment: FragmentRegistry): void {
  swRegistration?.active?.postMessage({
    type: "REGISTER_FRAGMENT",
    payload: fragment,
  });
}

function unregisterFragmentWithSW(fragmentId: string): void {
  swRegistration?.active?.postMessage({
    type: "UNREGISTER_FRAGMENT",
    payload: { fragmentId },
  });
}

/**
 * Create service-worker sandbox handler
 */
export function createServiceWorkerSandbox(config: SandboxConfig): SandboxStrategyHandler {
  const { fragmentId, origin, mountPath, allowMessageBus = true } = config;

  if (!origin) {
    throw new Error(`Service-worker sandbox requires "origin" for fragment "${fragmentId}"`);
  }

  const fragmentConfig: FragmentRegistry = {
    fragmentId,
    origin,
    mountPath,
    allowMessageBus,
  };

  return {
    async init() {
      if (swReady) {
        registerFragmentWithSW(fragmentConfig);
      } else {
        pendingFragments.push(fragmentConfig);
      }

      // Store cleanup function
      fragmentCleanups.set(fragmentId, () => {
        unregisterFragmentWithSW(fragmentId);
      });

      console.log(`[Piercing] Service-worker sandbox activated for: ${fragmentId}`);
    },

    cleanup() {
      const cleanup = fragmentCleanups.get(fragmentId);
      cleanup?.();
      fragmentCleanups.delete(fragmentId);

      console.log(`[Piercing] Service-worker sandbox deactivated for: ${fragmentId}`);
    },
  };
}

/**
 * Service Worker script content
 *
 * This should be served at /_piercing/sw.js
 */
export const SERVICE_WORKER_SCRIPT = `
// Piercing Service Worker
// Intercepts requests to external fragment origins and injects sandbox

const fragments = new Map();

// Listen for registration messages
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  if (type === 'REGISTER_FRAGMENT') {
    fragments.set(payload.fragmentId, payload);
    console.log('[Piercing SW] Registered:', payload.fragmentId);
  }

  if (type === 'UNREGISTER_FRAGMENT') {
    fragments.delete(payload.fragmentId);
    console.log('[Piercing SW] Unregistered:', payload.fragmentId);
  }
});

// Intercept fetch requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Find matching fragment
  let fragment = null;
  for (const [, config] of fragments) {
    if (url.pathname.startsWith(config.mountPath)) {
      fragment = config;
      break;
    }
    if (url.origin === new URL(config.origin).origin) {
      fragment = config;
      break;
    }
  }

  if (!fragment) return;

  // Handle HTML requests - inject sandbox script
  const accept = event.request.headers.get('accept') || '';
  if (accept.includes('text/html') || event.request.mode === 'navigate') {
    event.respondWith(handleHtmlRequest(event.request, fragment));
    return;
  }

  // Proxy other requests to fragment origin
  if (url.pathname.startsWith(fragment.mountPath)) {
    event.respondWith(proxyRequest(event.request, fragment));
  }
});

async function handleHtmlRequest(request, fragment) {
  // Rewrite URL to fragment origin
  const url = new URL(request.url);
  const fragmentPath = url.pathname.replace(fragment.mountPath, '');
  const fragmentUrl = fragment.origin + fragmentPath + url.search;

  try {
    const response = await fetch(fragmentUrl, {
      headers: request.headers,
      credentials: 'include',
    });

    if (!response.ok) return response;

    const html = await response.text();
    const modifiedHtml = injectSandboxScript(html, fragment);

    return new Response(modifiedHtml, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers({
        ...Object.fromEntries(response.headers.entries()),
        'content-type': 'text/html; charset=utf-8',
      }),
    });
  } catch (err) {
    console.error('[Piercing SW] Fetch error:', err);
    return new Response('Fragment unavailable', { status: 502 });
  }
}

async function proxyRequest(request, fragment) {
  const url = new URL(request.url);
  const fragmentPath = url.pathname.replace(fragment.mountPath, '');
  const fragmentUrl = fragment.origin + fragmentPath + url.search;

  return fetch(fragmentUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    credentials: 'include',
  });
}

function injectSandboxScript(html, fragment) {
  const script = \`
<script data-piercing-sandbox>
(function() {
  const fragmentId = "\${fragment.fragmentId}";
  const mountPath = "\${fragment.mountPath}";
  const allowMessageBus = \${fragment.allowMessageBus};

  // Intercept History API
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  function notifyShell(action, url, state) {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'PIERCING_NAVIGATE',
        payload: { fragmentId, action, url: mountPath + (url || '/'), state }
      });
    }
  }

  history.pushState = function(state, title, url) {
    notifyShell('push', url?.toString(), state);
  };

  history.replaceState = function(state, title, url) {
    notifyShell('replace', url?.toString(), state);
  };

  // Intercept link clicks
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#')) return;

    e.preventDefault();
    notifyShell('push', href);
  }, true);

  window.addEventListener('popstate', function(e) {
    notifyShell('pop', location.pathname, e.state);
  });

  console.log('[Piercing] Sandbox script injected for:', fragmentId);
})();
</script>
\`;

  // Inject after <head>
  return html.replace(/<head([^>]*)>/i, '<head$1>' + script);
}

// Activate immediately
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
`;
