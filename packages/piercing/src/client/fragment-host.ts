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
   * Move this fragment host into an outlet element
   */
  pierceInto(outlet: Element): void {
    // Preserve focus if it's inside this fragment
    const activeElement = this.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;

    // Temporarily disable cleanup while moving
    this.cleanup = false;
    outlet.appendChild(this);
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
    // Check if parent is a fragment outlet
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
  private static unmountedFragmentIds = new Set<string>();

  static get observedAttributes(): string[] {
    return ["fragment-id", "sandbox", "origin", "src"];
  }

  async connectedCallback(): Promise<void> {
    const fragmentId = this.getAttribute("fragment-id");
    const sandbox = (this.getAttribute("sandbox") || "none") as SandboxStrategy;
    const origin = this.getAttribute("origin") || undefined;
    const src = this.getAttribute("src") || undefined;

    if (!fragmentId && !src) {
      throw new Error("PiercingFragmentOutlet requires fragment-id or src attribute");
    }

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
      // Fragment was pre-pierced, move it into this outlet
      this.clearChildren();
      this.fragmentHost.pierceInto(this);
    } else {
      // Fetch the fragment on demand
      const fetchUrl = src || `/piercing-fragment/${fragmentId}${window.location.search}`;
      const stream = await this.fetchFragment(fetchUrl);
      await this.streamFragmentInto(fragmentId || "external", stream);
      if (fragmentId) {
        this.fragmentHost = this.findFragmentHost(fragmentId, true);
      }
    }
  }

  disconnectedCallback(): void {
    // Cleanup sandbox
    this.sandboxHandler?.cleanup();
    this.sandboxHandler = null;

    if (this.fragmentHost) {
      PiercingFragmentOutlet.unmountedFragmentIds.add(this.fragmentHost.fragmentId);
      this.fragmentHost = null;
    }
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
    while (this.firstChild) {
      this.removeChild(this.firstChild);
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
  private async streamFragmentInto(fragmentId: string, stream: ReadableStream): Promise<void> {
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

    // Move all body children into this outlet
    this.clearChildren();
    while (doc.body.firstChild) {
      this.appendChild(doc.body.firstChild);
    }

    // Re-run module scripts if fragment was previously unmounted
    if (PiercingFragmentOutlet.unmountedFragmentIds.has(fragmentId)) {
      this.rerunModuleScripts();
    }
  }

  private rerunModuleScripts(): void {
    const scripts = this.querySelectorAll('script[type="module"][src]');
    for (const script of scripts) {
      const src = (script as HTMLScriptElement).src;
      import(/* @vite-ignore */ src).then((module) => module.default?.());
    }
  }

  private findFragmentHost(fragmentId: string, insideOutlet = false): PiercingFragmentHost | null {
    const root = insideOutlet ? this : document;
    return root.querySelector(`piercing-fragment-host[fragment-id="${fragmentId}"]`);
  }
}

/**
 * Register the web components
 * Call this once at application startup
 */
export function registerPiercingComponents(): void {
  if (typeof window === "undefined") return;

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
