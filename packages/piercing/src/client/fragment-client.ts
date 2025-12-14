import type { JSONValue, MessageBus, MessageBusState } from "../types";

/**
 * Symbol used to attach MessageBus to fragment host elements
 * Must match the one used in fragment-host.ts
 */
export const FRAGMENT_MESSAGE_BUS_SYMBOL = Symbol.for("piercing:fragment-message-bus");

/**
 * Piercing client for fragments
 *
 * Provides a unified API for fragments to communicate with the shell
 * regardless of sandbox strategy (iframe, monkey-patch, service-worker).
 *
 * @example
 * ```typescript
 * import { getPiercingClient } from '@buntime/piercing/client';
 *
 * const piercing = getPiercingClient();
 *
 * // Read shared state
 * const user = piercing.state.user;
 *
 * // Listen for state changes
 * piercing.onStateChange((state) => {
 *   console.log('State updated:', state);
 * });
 *
 * // Dispatch event to shell
 * piercing.dispatch('cart:updated', { items: 3 });
 *
 * // Listen for events from shell or other fragments
 * piercing.on('theme:changed', (theme) => {
 *   console.log('Theme changed to:', theme);
 * });
 * ```
 */
export interface PiercingClient {
  /**
   * Current shared state from the shell
   */
  readonly state: MessageBusState;

  /**
   * Listen for state changes from the shell
   * @param callback Function called when state changes
   * @returns Cleanup function to stop listening
   */
  onStateChange(callback: (state: MessageBusState) => void): () => void;

  /**
   * Dispatch an event to the shell (and other fragments)
   * @param eventName Name of the event
   * @param payload Data to send with the event
   */
  dispatch(eventName: string, payload: JSONValue): void;

  /**
   * Listen for events from the shell or other fragments
   * @param eventName Name of the event to listen for
   * @param callback Function called when event is received
   * @returns Cleanup function to stop listening
   */
  on<T extends JSONValue = JSONValue>(
    eventName: string,
    callback: (payload: T) => void,
  ): () => void;

  /**
   * Navigate within the fragment (notifies shell)
   * @param url URL to navigate to (relative to fragment mount path)
   * @param options Navigation options
   */
  navigate(url: string, options?: { replace?: boolean; state?: JSONValue }): void;
}

// Global state storage
declare global {
  interface Window {
    __PIERCING_STATE__?: MessageBusState;
    __PIERCING_CLIENT__?: PiercingClient;
  }
}

// Event names for internal communication
const EVENTS = {
  STATE_CHANGE: "piercing:state",
  DISPATCH: "piercing:dispatch",
  NAVIGATE: "piercing:navigate",
} as const;

/**
 * Create the piercing client singleton
 */
function createPiercingClient(): PiercingClient {
  // Initialize state from global if available
  if (!window.__PIERCING_STATE__) {
    window.__PIERCING_STATE__ = {};
  }

  const client: PiercingClient = {
    get state() {
      return window.__PIERCING_STATE__ ?? {};
    },

    onStateChange(callback) {
      const handler = (e: Event) => {
        const state = (e as CustomEvent<MessageBusState>).detail;
        callback(state);
      };

      window.addEventListener(EVENTS.STATE_CHANGE, handler);
      return () => window.removeEventListener(EVENTS.STATE_CHANGE, handler);
    },

    dispatch(eventName, payload) {
      window.dispatchEvent(
        new CustomEvent(EVENTS.DISPATCH, {
          detail: { eventName, payload },
        }),
      );
    },

    on(eventName, callback) {
      const handler = (e: Event) => {
        const { name, payload } = (e as CustomEvent<{ name: string; payload: JSONValue }>).detail;
        if (name === eventName) {
          callback(payload as Parameters<typeof callback>[0]);
        }
      };

      window.addEventListener(`piercing:event`, handler);
      return () => window.removeEventListener(`piercing:event`, handler);
    },

    navigate(url, options = {}) {
      const { replace = false, state = null } = options;

      window.dispatchEvent(
        new CustomEvent(EVENTS.NAVIGATE, {
          detail: {
            action: replace ? "replace" : "push",
            state,
            url,
          },
        }),
      );
    },
  };

  return client;
}

/**
 * Get the piercing client instance
 *
 * Returns a singleton client for communicating with the shell.
 * Safe to call multiple times - returns the same instance.
 *
 * @example
 * ```typescript
 * const piercing = getPiercingClient();
 *
 * // In React
 * function MyComponent() {
 *   const [user, setUser] = useState(piercing.state.user);
 *
 *   useEffect(() => {
 *     return piercing.onStateChange((state) => {
 *       setUser(state.user);
 *     });
 *   }, []);
 *
 *   return <div>Hello {user?.name}</div>;
 * }
 * ```
 */
export function getPiercingClient(): PiercingClient {
  if (typeof window === "undefined") {
    // SSR: return a no-op client
    return {
      state: {},
      dispatch: () => {},
      navigate: () => {},
      on: () => () => {},
      onStateChange: () => () => {},
    };
  }

  if (!window.__PIERCING_CLIENT__) {
    window.__PIERCING_CLIENT__ = createPiercingClient();
  }

  return window.__PIERCING_CLIENT__;
}

/**
 * React hook for piercing state (optional helper)
 *
 * @example
 * ```typescript
 * import { usePiercingState } from '@buntime/piercing/client';
 *
 * function MyComponent() {
 *   const state = usePiercingState();
 *   return <div>Theme: {state.theme}</div>;
 * }
 * ```
 */
export function usePiercingState(): MessageBusState {
  // This is a simple implementation that works without React dependency
  // For full React integration, users should use getPiercingClient() with useState/useEffect
  return getPiercingClient().state;
}

/**
 * Interface for elements that have an attached MessageBus
 */
interface ElementWithMessageBus extends Element {
  [FRAGMENT_MESSAGE_BUS_SYMBOL]?: MessageBus;
}

/**
 * Get the MessageBus for a given element by walking up the DOM tree
 *
 * This allows fragments to automatically find the correct bus based on their
 * position in the DOM hierarchy. Nested fragments will get their parent's bus.
 *
 * @param element - Starting element to search from (optional)
 * @returns The MessageBus for this context (fragment-scoped or global)
 *
 * @example
 * ```typescript
 * import { getBus } from '@buntime/piercing/client';
 *
 * // In a React component
 * function MyComponent() {
 *   const ref = useRef<HTMLDivElement>(null);
 *
 *   useEffect(() => {
 *     const bus = getBus(ref.current);
 *     return bus.listen('event', (value) => {
 *       console.log('Received:', value);
 *     });
 *   }, []);
 *
 *   return <div ref={ref}>...</div>;
 * }
 *
 * // In vanilla JS
 * const element = document.getElementById('my-element');
 * const bus = getBus(element);
 * bus.dispatch('myEvent', { data: 'value' });
 * ```
 */
export function getBus(element?: Element | null): MessageBus {
  if (typeof window === "undefined") {
    // SSR: return a no-op bus
    return {
      state: {},
      dispatch: () => {},
      latestValue: () => undefined,
      listen: () => () => {},
    };
  }

  // Walk up the DOM tree to find the nearest fragment host with a bus
  let current: Element | null = element ?? null;

  while (current) {
    // Check if this element has a message bus attached
    const bus = (current as ElementWithMessageBus)[FRAGMENT_MESSAGE_BUS_SYMBOL];
    if (bus) {
      return bus;
    }

    // Check if this is a piercing-fragment-host element
    if (current.tagName?.toLowerCase() === "piercing-fragment-host") {
      const hostBus = (current as ElementWithMessageBus)[FRAGMENT_MESSAGE_BUS_SYMBOL];
      if (hostBus) {
        return hostBus;
      }
    }

    current = current.parentElement;
  }

  // No fragment host found, return global bus via client
  // This creates a MessageBus-compatible wrapper around the global client
  return createGlobalBusAdapter();
}

/**
 * Interface for PiercingFragmentHost element
 * Used by getFragmentHost to provide typed access to host methods
 */
export interface FragmentHost extends HTMLElement {
  /** The fragment's unique identifier */
  fragmentId: string;

  /**
   * Register a cleanup handler to run when the fragment is removed
   * @param handler Function to call on cleanup
   *
   * @example
   * ```typescript
   * const host = getFragmentHost(myElement);
   * host?.onCleanup(() => {
   *   // Clear state, cancel subscriptions, etc.
   *   getBus(myElement).dispatch("my-event", null);
   * });
   * ```
   */
  onCleanup(handler: () => void): void;
}

/**
 * Get the nearest PiercingFragmentHost ancestor for a given element
 *
 * This allows fragments to access their host element to register cleanup
 * handlers or access fragment metadata.
 *
 * @param element - Starting element to search from
 * @returns The nearest FragmentHost or null if not inside a fragment
 *
 * @example
 * ```typescript
 * import { getFragmentHost, getBus } from '@buntime/piercing/client';
 *
 * // In a React component
 * function MyComponent() {
 *   const ref = useRef<HTMLDivElement>(null);
 *
 *   useEffect(() => {
 *     const host = getFragmentHost(ref.current);
 *
 *     // Register cleanup when fragment is removed
 *     host?.onCleanup(() => {
 *       getBus(ref.current).dispatch("my-state", null);
 *     });
 *   }, []);
 *
 *   return <div ref={ref}>...</div>;
 * }
 *
 * // In vanilla JS
 * const element = document.getElementById('my-element');
 * const host = getFragmentHost(element);
 * console.log('Fragment ID:', host?.fragmentId);
 * ```
 */
export function getFragmentHost(element?: Element | null): FragmentHost | null {
  if (typeof window === "undefined" || !element) {
    return null;
  }

  let current: Element | null = element;

  while (current) {
    if (current.tagName?.toLowerCase() === "piercing-fragment-host") {
      return current as FragmentHost;
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Create a MessageBus-compatible adapter for the global piercing client
 */
function createGlobalBusAdapter(): MessageBus {
  const client = getPiercingClient();

  return {
    get state() {
      return client.state;
    },

    dispatch(eventName: string, value: JSONValue) {
      client.dispatch(eventName, value);
    },

    listen(eventName, callback) {
      // For wildcard, listen to all events
      if (eventName === "*") {
        return client.onStateChange((state) => {
          // Call with state changes - eventName is implicit
          (callback as (value: JSONValue, eventName?: string) => void)(state, "*");
        });
      }

      return client.on(eventName, callback);
    },

    latestValue<T extends JSONValue>(eventName: string): T | undefined {
      return client.state[eventName] as T | undefined;
    },
  };
}
