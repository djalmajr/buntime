import { getBus as getGlobalBus } from "../message-bus/client-message-bus";
import {
  createSandbox,
  type SandboxConfig,
  type SandboxStrategy,
  type SandboxStrategyHandler,
} from "../sandbox";
import type { JSONValue, MessageBusCallback } from "../types";

/**
 * Symbol for accessing the fragment's message bus
 * Uses Symbol.for() to create a global symbol that can be accessed from fragment-client.ts
 */
const MESSAGE_BUS_PROP = Symbol.for("piercing:fragment-message-bus");

/**
 * Fragment-specific message bus that scopes events to a fragment
 */
class FragmentMessageBus {
  private cleanupHandlers: (() => void)[] = [];

  get state() {
    return getGlobalBus().state;
  }

  dispatch(eventName: string, value: JSONValue): void {
    getGlobalBus().dispatch(eventName, value);
  }

  listen<T extends JSONValue>(eventName: string, callback: MessageBusCallback<T>): () => void {
    const cleanup = getGlobalBus().listen(eventName, callback);
    this.cleanupHandlers.push(cleanup);
    return cleanup;
  }

  latestValue<T extends JSONValue>(eventName: string): T | undefined {
    return getGlobalBus().latestValue<T>(eventName);
  }

  clearAllHandlers(): void {
    for (const cleanup of this.cleanupHandlers) {
      cleanup();
    }
    this.cleanupHandlers = [];
  }
}

/**
 * Web component that hosts a fragment's SSR content
 * Wraps the fragment HTML and manages its lifecycle
 */
export class PiercingFragmentHost extends HTMLElement {
  private cleanup = true;
  private stylesObserver?: MutationObserver;
  private cleanupHandlers: (() => void)[] = [];

  [MESSAGE_BUS_PROP] = new FragmentMessageBus();
  fragmentId!: string;

  connectedCallback(): void {
    const fragmentId = this.getAttribute("fragment-id");

    if (!fragmentId) {
      throw new Error("PiercingFragmentHost requires a fragment-id attribute");
    }

    this.fragmentId = fragmentId;

    // If not pierced yet, observe for styles to embed
    if (!this.isPierced) {
      this.setupStylesObserver();
    }
  }

  disconnectedCallback(): void {
    if (this.cleanup) {
      // Only cleanup if we're actually being removed (not just moved)
      this[MESSAGE_BUS_PROP].clearAllHandlers();
      for (const handler of this.cleanupHandlers) {
        handler();
      }
      this.cleanupHandlers = [];
    }
  }

  /**
   * Move this fragment host into an outlet element or shadow root
   */
  pierceInto(target: Element | ShadowRoot): void {
    // Preserve focus if it's inside this fragment
    const activeElement = this.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;

    // Temporarily disable cleanup while moving
    this.cleanup = false;
    target.appendChild(this);
    this.cleanup = true;

    // Restore focus
    activeElement?.focus();

    // Stop observing styles since we're now pierced
    this.removeStylesObserver();
  }

  /**
   * Register a cleanup handler to run when the fragment is removed
   */
  onCleanup(handler: () => void): void {
    this.cleanupHandlers.push(handler);
  }

  /**
   * Get the fragment's message bus
   */
  get messageBus(): FragmentMessageBus {
    return this[MESSAGE_BUS_PROP];
  }

  private get isPierced(): boolean {
    // Check if inside a fragment outlet's shadow root
    const root = this.getRootNode();
    if (root instanceof ShadowRoot) {
      return (root.host as PiercingFragmentOutlet | null)?.piercingFragmentOutlet === true;
    }
    // Fallback: check parent element (for light DOM)
    return (this.parentElement as PiercingFragmentOutlet | null)?.piercingFragmentOutlet === true;
  }

  private setupStylesObserver(): void {
    this.stylesObserver = new MutationObserver((mutations) => {
      const hasAddedElements = mutations.some((mutation) => {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) return true;
        }
        return false;
      });

      if (hasAddedElements) {
        this.embedExternalStyles();
      }
    });

    this.stylesObserver.observe(this, {
      childList: true,
      subtree: true,
    });
  }

  private removeStylesObserver(): void {
    this.stylesObserver?.disconnect();
    this.stylesObserver = undefined;
  }

  /**
   * Convert external stylesheet links to inline styles
   * This is needed because fragments may have CSS from different origins
   */
  private embedExternalStyles(): void {
    const styleLinks = this.querySelectorAll<HTMLLinkElement>('link[href][rel="stylesheet"]');

    for (const link of styleLinks) {
      if (link.sheet) {
        let cssText = "";
        for (const rule of link.sheet.cssRules) {
          cssText += `${rule.cssText}\n`;
        }

        const style = document.createElement("style");
        style.textContent = cssText;
        link.replaceWith(style);
      }
    }
  }
}

/**
 * Web component that acts as a placeholder for a fragment
 * Handles fetching and piercing the fragment into place
 *
 * Uses Shadow DOM for CSS isolation - fragment styles don't leak to shell and vice versa.
 *
 * Supports sandbox strategies via attributes:
 * - sandbox="none" (default): No isolation
 * - sandbox="monkey-patch": Intercepts History API
 * - sandbox="iframe": Full isolation via iframe
 * - sandbox="service-worker": SW-based interception
 *
 * Additional attributes:
 * - origin: External origin (required for iframe/service-worker)
 * - src: Direct URL to fetch fragment from (alternative to fragment-id)
 *
 * @example
 * <!-- Internal plugin -->
 * <piercing-fragment-outlet fragment-id="logs" />
 *
 * @example
 * <!-- External app with monkey-patch -->
 * <piercing-fragment-outlet
 *   fragment-id="legacy"
 *   sandbox="monkey-patch"
 * />
 *
 * @example
 * <!-- External app with iframe isolation -->
 * <piercing-fragment-outlet
 *   fragment-id="external"
 *   sandbox="iframe"
 *   origin="https://external-app.com"
 * />
 */
export class PiercingFragmentOutlet extends HTMLElement {
  /** Marker for identifying this as an outlet (used by fragment host) */
  readonly piercingFragmentOutlet = true;

  private fragmentHost: PiercingFragmentHost | null = null;
  private sandboxHandler: SandboxStrategyHandler | null = null;
  private shadow: ShadowRoot;
  private currentFragmentId: string | null = null;
  private static unmountedFragmentIds = new Set<string>();

  constructor() {
    super();
    // Attach shadow DOM for CSS isolation
    this.shadow = this.attachShadow({ mode: "open" });
  }

  static get observedAttributes(): string[] {
    return ["fragment-id", "sandbox", "origin", "src"];
  }

  async connectedCallback(): Promise<void> {
    // Register shadow root for getElementById hijack
    registerOutletShadowRoot(this.shadow);
    const fragmentId = this.getAttribute("fragment-id");
    const sandbox = (this.getAttribute("sandbox") || "none") as SandboxStrategy;
    const origin = this.getAttribute("origin") || undefined;
    const src = this.getAttribute("src") || undefined;

    if (!fragmentId && !src) {
      throw new Error("PiercingFragmentOutlet requires fragment-id or src attribute");
    }

    // Store fragmentId for unmount tracking
    this.currentFragmentId = fragmentId || "external";

    // For iframe strategy, we don't fetch - iframe handles its own loading
    if (sandbox === "iframe") {
      await this.initIframeSandbox(fragmentId || "external", origin);
      return;
    }

    // Initialize sandbox before loading fragment (for monkey-patch/service-worker)
    if (sandbox !== "none") {
      this.sandboxHandler = this.initSandbox(fragmentId || "external", sandbox, origin);
      await this.sandboxHandler?.init();
    }

    // Check if fragment host already exists in DOM (pre-pierced)
    if (fragmentId) {
      this.fragmentHost = this.findFragmentHost(fragmentId);
    }

    if (this.fragmentHost) {
      // Fragment was pre-pierced, move it into shadow root for CSS isolation
      this.clearChildren();
      this.fragmentHost.pierceInto(this.shadow);
    } else {
      // Fetch the fragment on demand from /p/{plugin} (plugin routes)
      const fetchUrl = src || `/p/${fragmentId}${window.location.search}`;
      const stream = await this.fetchFragment(fetchUrl);
      const baseUrl = src || `/p/${fragmentId}`;
      await this.streamFragmentInto(fragmentId || "external", stream, baseUrl);
      if (fragmentId) {
        this.fragmentHost = this.findFragmentHost(fragmentId, true);
      }
    }
  }

  disconnectedCallback(): void {
    // Dispatch unmount event so fragments can cleanup (React unmount, clear intervals, etc)
    this.shadow.dispatchEvent(
      new CustomEvent("piercing-unmount", { bubbles: true, composed: true }),
    );

    // Unregister shadow root from getElementById hijack
    unregisterOutletShadowRoot(this.shadow);

    // Track unmounted fragment for script re-run on remount
    if (this.currentFragmentId) {
      PiercingFragmentOutlet.unmountedFragmentIds.add(this.currentFragmentId);
    }

    // Cleanup sandbox
    this.sandboxHandler?.cleanup();
    this.sandboxHandler = null;
    this.fragmentHost = null;
  }

  private initSandbox(
    fragmentId: string,
    strategy: SandboxStrategy,
    origin?: string,
  ): SandboxStrategyHandler | null {
    const mountPath = this.getMountPath();

    const config: SandboxConfig = {
      fragmentId,
      strategy,
      origin,
      mountPath,
      allowMessageBus: true,
    };

    return createSandbox(config, this);
  }

  private async initIframeSandbox(fragmentId: string, origin?: string): Promise<void> {
    const mountPath = this.getMountPath();

    const config: SandboxConfig = {
      fragmentId,
      strategy: "iframe",
      origin,
      mountPath,
      allowMessageBus: true,
    };

    this.sandboxHandler = createSandbox(config, this);
    await this.sandboxHandler?.init();
  }

  private getMountPath(): string {
    // Try to determine mount path from current URL or attribute
    const pathname = window.location.pathname;
    const fragmentId = this.getAttribute("fragment-id");

    // If we're at /cpanel/logs, mount path is /cpanel/logs
    if (fragmentId && pathname.includes(fragmentId)) {
      return pathname;
    }

    return pathname;
  }

  private clearChildren(): void {
    while (this.shadow.firstChild) {
      this.shadow.removeChild(this.shadow.firstChild);
    }
  }

  private async fetchFragment(url: string): Promise<ReadableStream> {
    const state = getGlobalBus().state;

    const response = await fetch(url, {
      headers: {
        "x-message-bus-state": JSON.stringify(state),
      },
    });

    if (!response.body) {
      throw new Error(`Empty response when fetching fragment from "${url}"`);
    }

    return response.body;
  }

  /**
   * Stream fragment HTML into this outlet using DOM parsing
   * Uses DOMParser for safe HTML parsing from trusted SSR content
   */
  private async streamFragmentInto(
    fragmentId: string,
    stream: ReadableStream,
    baseUrl: string,
  ): Promise<void> {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let html = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += value;
    }

    // Parse HTML safely using DOMParser
    // This is SSR content from our own server, so it's trusted
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Move all body children into shadow root for CSS isolation
    this.clearChildren();

    // Store the plugin's base URL as a data attribute so fragments can access it for API calls
    // baseUrl is already /p/{plugin} (unified with plugin routes)
    this.setAttribute("data-fragment-base", baseUrl);

    // First, append stylesheets and scripts from head
    // This ensures styles and scripts are included even if they're in <head>
    const headLinks = doc.head.querySelectorAll('link[rel="stylesheet"]');
    const headScripts = doc.head.querySelectorAll("script");

    for (const link of headLinks) {
      const newLink = link.cloneNode(true) as HTMLLinkElement;
      // Resolve relative URLs to absolute URLs based on fragment baseUrl
      const href = link.getAttribute("href");
      if (href?.startsWith("./")) {
        newLink.setAttribute("href", `${baseUrl}/${href.slice(2)}`);
      }
      this.shadow.appendChild(newLink);
    }

    // Check if this fragment was previously unmounted (needs cache-busting for scripts)
    const wasUnmounted = PiercingFragmentOutlet.unmountedFragmentIds.has(fragmentId);
    const cacheBuster = wasUnmounted ? `?_t=${Date.now()}` : "";

    for (const oldScript of headScripts) {
      // Create new script element to ensure it executes
      const newScript = document.createElement("script");

      // Copy all attributes and resolve relative URLs
      for (const attr of oldScript.attributes) {
        let value = attr.value;
        // Resolve relative src URLs to absolute URLs based on fragment baseUrl
        if (attr.name === "src") {
          if (value.startsWith("./")) {
            value = `${baseUrl}/${value.slice(2)}`;
          }
          // Add cache-buster for remounted fragments to force script re-execution
          if (wasUnmounted && !value.includes("?")) {
            value = `${value}${cacheBuster}`;
          }
        }
        newScript.setAttribute(attr.name, value);
      }

      // Copy text content if inline script
      if (oldScript.textContent) {
        newScript.textContent = oldScript.textContent;
      }

      this.shadow.appendChild(newScript);
    }

    // Process body content - resolve URLs for links and scripts
    const bodyLinks = doc.body.querySelectorAll('link[rel="stylesheet"]');
    const bodyScripts = doc.body.querySelectorAll("script");

    // Resolve stylesheet URLs in body
    for (const link of bodyLinks) {
      const href = link.getAttribute("href");
      if (href?.startsWith("./")) {
        link.setAttribute("href", `${baseUrl}/${href.slice(2)}`);
      }
    }

    // Resolve script URLs in body and add cache-buster if needed
    for (const script of bodyScripts) {
      const src = script.getAttribute("src");
      if (src) {
        let resolvedSrc = src.startsWith("./") ? `${baseUrl}/${src.slice(2)}` : src;
        if (wasUnmounted && !resolvedSrc.includes("?")) {
          resolvedSrc = `${resolvedSrc}${cacheBuster}`;
        }
        script.setAttribute("src", resolvedSrc);
      }
    }

    // Append body content to shadow root
    while (doc.body.firstChild) {
      const node = doc.body.firstChild;

      // Scripts need to be recreated to execute
      if (node instanceof HTMLScriptElement) {
        const newScript = document.createElement("script");
        for (const attr of node.attributes) {
          newScript.setAttribute(attr.name, attr.value);
        }
        if (node.textContent) {
          newScript.textContent = node.textContent;
        }
        this.shadow.appendChild(newScript);
        node.remove();
      } else {
        this.shadow.appendChild(node);
      }
    }
  }

  private findFragmentHost(fragmentId: string, insideOutlet = false): PiercingFragmentHost | null {
    const root = insideOutlet ? this.shadow : document;
    return root.querySelector(`piercing-fragment-host[fragment-id="${fragmentId}"]`);
  }
}

/**
 * Track all outlet shadow roots for getElementById hijack
 */
const outletShadowRoots = new Set<ShadowRoot>();

/**
 * Original getElementById function
 */
let originalGetElementById: typeof document.getElementById | null = null;

/**
 * Hijack document.getElementById to search shadow roots first
 * This allows fragments inside shadow DOM to find their root elements
 */
function installGetElementByIdHijack(): void {
  if (originalGetElementById) return; // Already installed

  originalGetElementById = document.getElementById.bind(document);

  document.getElementById = function (id: string): HTMLElement | null {
    // First, search in shadow roots (fragments)
    for (const shadowRoot of outletShadowRoots) {
      const element = shadowRoot.getElementById(id);
      if (element) return element;
    }
    // Fall back to main document
    return originalGetElementById!(id);
  };
}

/**
 * Register a shadow root to be searched by getElementById
 */
export function registerOutletShadowRoot(shadowRoot: ShadowRoot): void {
  outletShadowRoots.add(shadowRoot);
}

/**
 * Unregister a shadow root from getElementById searches
 */
export function unregisterOutletShadowRoot(shadowRoot: ShadowRoot): void {
  outletShadowRoots.delete(shadowRoot);
}

/**
 * Register the web components
 * Call this once at application startup
 */
export function registerPiercingComponents(): void {
  if (typeof window === "undefined") return;

  // Install getElementById hijack for shadow DOM support
  installGetElementByIdHijack();

  if (!customElements.get("piercing-fragment-host")) {
    customElements.define("piercing-fragment-host", PiercingFragmentHost);
  }

  if (!customElements.get("piercing-fragment-outlet")) {
    customElements.define("piercing-fragment-outlet", PiercingFragmentOutlet);
  }
}

// TypeScript JSX support for web components
// Users should add these to their own global types if needed:
// declare global {
//   namespace JSX {
//     interface IntrinsicElements {
//       "piercing-fragment-host": { "fragment-id": string } & Record<string, unknown>;
//       "piercing-fragment-outlet": { "fragment-id": string } & Record<string, unknown>;
//     }
//   }
// }
