import WritableDOM from "writable-dom";
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
 *
 * @example
 * <fragment-host src="/p/metrics">...SSR content...</fragment-host>
 */
export class PiercingFragmentHost extends HTMLElement {
  private cleanup = true;
  private stylesObserver?: MutationObserver;
  private cleanupHandlers: (() => void)[] = [];

  [MESSAGE_BUS_PROP] = new FragmentMessageBus();
  fragmentId!: string;

  connectedCallback(): void {
    const src = this.getAttribute("src");

    if (!src) {
      throw new Error("PiercingFragmentHost requires a src attribute");
    }

    // Derive fragmentId from src for internal tracking
    this.fragmentId = src.split("/").pop() || "fragment";

    // If not pierced yet, observe for styles to embed
    if (!this.isPierced) {
      this.setupStylesObserver();
    }
  }

  /**
   * Get the src attribute value (fragment URL path)
   */
  get src(): string | null {
    return this.getAttribute("src");
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

    for (const link of Array.from(styleLinks)) {
      if (link.sheet) {
        let cssText = "";
        for (const rule of Array.from(link.sheet.cssRules)) {
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
 * Supports history isolation strategies via attributes:
 * - No history attribute: No isolation (just fetch and stream)
 * - history="patch": Intercepts History API
 * - history="isolate": Full isolation via iframe
 *
 * Required attributes:
 * - src: URL to fetch fragment from (REQUIRED)
 *
 * Optional attributes:
 * - base: Shell's basepath for routing context
 * - history: History isolation strategy ("patch" | "isolate")
 *
 * @example
 * <!-- Basic fragment without isolation -->
 * <fragment-outlet src="/p/metrics" base="/cpanel" />
 *
 * @example
 * <!-- Fragment with history patch -->
 * <fragment-outlet
 *   src="/p/metrics"
 *   base="/cpanel"
 *   history="patch"
 * />
 *
 * @example
 * <!-- External app with iframe isolation -->
 * <fragment-outlet
 *   src="/external"
 *   base="/cpanel"
 *   history="isolate"
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
    return ["src", "base", "history"];
  }

  async connectedCallback(): Promise<void> {
    // Register shadow root for getElementById hijack
    registerOutletShadowRoot(this.shadow);

    const src = this.getAttribute("src");
    const history = this.getAttribute("history") as "patch" | "isolate" | null;

    if (!src) {
      throw new Error("PiercingFragmentOutlet requires a src attribute");
    }

    // Derive fragmentId from src for unmount tracking
    const fragmentId = src.split("/").pop() || "fragment";
    this.currentFragmentId = fragmentId;

    // For iframe isolation, we don't fetch - iframe handles its own loading
    if (history === "isolate") {
      await this.initIframeSandbox(fragmentId);
      return;
    }

    // Initialize sandbox before loading fragment (for patch)
    if (history === "patch") {
      this.sandboxHandler = this.initSandbox(fragmentId, "patch");
      await this.sandboxHandler?.init();
    }

    // Check if fragment host already exists in DOM (pre-pierced)
    this.fragmentHost = this.findFragmentHost(src);

    if (this.fragmentHost) {
      // Fragment was pre-pierced, move it into shadow root for CSS isolation
      this.clearChildren();
      this.fragmentHost.pierceInto(this.shadow);
    } else {
      // Fetch the fragment on demand
      const fetchUrl = `${src}${window.location.search}`;
      const stream = await this.fetchFragment(fetchUrl);
      await this.streamFragmentInto(fragmentId, stream, src);
      this.fragmentHost = this.findFragmentHost(src, true);
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

  async attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): Promise<void> {
    // Only handle src changes after initial connection
    if (name !== "src" || oldValue === null || oldValue === newValue) {
      return;
    }

    // Dispatch unmount event for old fragment
    this.shadow.dispatchEvent(
      new CustomEvent("piercing-unmount", { bubbles: true, composed: true }),
    );

    // Track old fragment as unmounted
    if (this.currentFragmentId) {
      PiercingFragmentOutlet.unmountedFragmentIds.add(this.currentFragmentId);
    }

    // Cleanup old sandbox
    this.sandboxHandler?.cleanup();
    this.sandboxHandler = null;
    this.fragmentHost = null;

    // Clear shadow DOM
    this.clearChildren();

    // Load new fragment
    const src = newValue;
    if (!src) return;

    const fragmentId = src.split("/").pop() || "fragment";
    this.currentFragmentId = fragmentId;

    const history = this.getAttribute("history") as "patch" | "isolate" | null;

    // Initialize sandbox for new fragment if needed
    if (history === "patch") {
      this.sandboxHandler = this.initSandbox(fragmentId, "patch");
      await this.sandboxHandler?.init();
    }

    // Fetch and load new fragment
    const fetchUrl = `${src}${window.location.search}`;
    const stream = await this.fetchFragment(fetchUrl);
    await this.streamFragmentInto(fragmentId, stream, src);
    this.fragmentHost = this.findFragmentHost(src, true);
  }

  private initSandbox(
    fragmentId: string,
    strategy: SandboxStrategy,
  ): SandboxStrategyHandler | null {
    const src = this.getAttribute("src");
    const mountPath = this.getMountPath();

    if (!src) {
      throw new Error("src attribute is required for sandbox initialization");
    }

    const config: SandboxConfig = {
      src,
      fragmentId,
      strategy,
      mountPath,
      allowMessageBus: true,
    };

    return createSandbox(config, this);
  }

  private async initIframeSandbox(fragmentId: string): Promise<void> {
    const src = this.getAttribute("src");
    const mountPath = this.getMountPath();

    if (!src) {
      throw new Error("src attribute is required for sandbox initialization");
    }

    const config: SandboxConfig = {
      src,
      fragmentId,
      strategy: "isolate",
      mountPath,
      allowMessageBus: true,
    };

    this.sandboxHandler = createSandbox(config, this);
    await this.sandboxHandler?.init();
  }

  private getMountPath(): string {
    // Use base attribute if provided, otherwise use current pathname
    return this.getAttribute("base") || window.location.pathname;
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
   * Stream fragment HTML into this outlet using writable-dom
   * Uses WritableDOM for efficient streaming HTML parsing
   */
  private async streamFragmentInto(
    fragmentId: string,
    stream: ReadableStream,
    baseUrl: string,
  ): Promise<void> {
    // Clear shadow DOM before streaming
    this.clearChildren();

    // Store the plugin's base URL as a data attribute so fragments can access it for API calls
    this.setAttribute("data-fragment-base", baseUrl);

    // Check if this fragment was previously unmounted (needs cache-busting for scripts)
    const wasUnmounted = PiercingFragmentOutlet.unmountedFragmentIds.has(fragmentId);
    const cacheBuster = wasUnmounted ? `?_t=${Date.now()}` : "";

    // Create transform stream to rewrite relative URLs before parsing
    // This is needed because WritableDOM parses elements immediately, triggering
    // resource loads before we can post-process the URLs
    const urlRewriteTransform = new TransformStream<string, string>({
      transform(chunk, controller) {
        // Rewrite src="./..." and href="./..." to absolute URLs
        let modified = chunk
          .replace(/src="\.\/([^"]+)"/g, `src="${baseUrl}/$1"`)
          .replace(/href="\.\/([^"]+)"/g, `href="${baseUrl}/$1"`);

        // Add cache buster for scripts if fragment was previously unmounted
        if (wasUnmounted) {
          modified = modified.replace(
            new RegExp(`src="${baseUrl}/([^"?]+)"`, "g"),
            `src="${baseUrl}/$1${cacheBuster}"`,
          );
        }

        controller.enqueue(modified);
      },
    });

    // Stream HTML with rewritten URLs into shadow root
    const textStream = stream.pipeThrough(new TextDecoderStream()).pipeThrough(urlRewriteTransform);

    const writable = new WritableDOM(this.shadow);
    await textStream.pipeTo(writable);
  }

  private findFragmentHost(src: string, insideOutlet = false): PiercingFragmentHost | null {
    const root = insideOutlet ? this.shadow : document;
    return root.querySelector(`fragment-host[src="${src}"]`);
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
    for (const shadowRoot of Array.from(outletShadowRoots)) {
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

  if (!customElements.get("fragment-host")) {
    customElements.define("fragment-host", PiercingFragmentHost);
  }

  if (!customElements.get("fragment-outlet")) {
    customElements.define("fragment-outlet", PiercingFragmentOutlet);
  }
}

// TypeScript JSX support for web components
// Users should add these to their own global types if needed:
// declare global {
//   namespace JSX {
//     interface IntrinsicElements {
//       "fragment-host": { "fragment-id": string } & Record<string, unknown>;
//       "fragment-outlet": { "fragment-id": string } & Record<string, unknown>;
//     }
//   }
// }
