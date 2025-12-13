import type { JSONValue, MessageBusCallback, MessageBusState } from "../types";
import { GenericMessageBus } from "./message-bus";

/**
 * Window property name for the global message bus
 */
const GLOBAL_BUS_KEY = "__PIERCING_MESSAGE_BUS__";

declare global {
  interface Window {
    [GLOBAL_BUS_KEY]?: ClientMessageBus;
    __PIERCING_MESSAGE_BUS_STATE__?: MessageBusState;
  }
}

/**
 * Client-side message bus with global singleton access
 */
export class ClientMessageBus extends GenericMessageBus {
  private constructor(state: MessageBusState = {}) {
    super(state);
  }

  /**
   * Get the global message bus instance (creates one if it doesn't exist)
   */
  static getInstance(): ClientMessageBus {
    if (typeof window === "undefined") {
      throw new Error("ClientMessageBus can only be used in browser");
    }

    if (!window[GLOBAL_BUS_KEY]) {
      // Initialize from injected state if available
      const initialState = window.__PIERCING_MESSAGE_BUS_STATE__ ?? {};
      window[GLOBAL_BUS_KEY] = new ClientMessageBus(initialState);
    }

    return window[GLOBAL_BUS_KEY];
  }

  /**
   * Initialize the client message bus from injected state
   * This is called by the inline script injected by the gateway
   */
  static initialize(state: MessageBusState): ClientMessageBus {
    if (typeof window === "undefined") {
      throw new Error("ClientMessageBus can only be used in browser");
    }

    window.__PIERCING_MESSAGE_BUS_STATE__ = state;
    window[GLOBAL_BUS_KEY] = new ClientMessageBus(state);
    return window[GLOBAL_BUS_KEY];
  }
}

/**
 * Get the global message bus instance
 * Convenience function for use in fragments
 */
export function getBus(): ClientMessageBus {
  return ClientMessageBus.getInstance();
}

/**
 * React hook for subscribing to message bus events
 * @param eventName - The event to subscribe to
 * @returns The latest value and a dispatch function
 */
export function useMessageBus<T extends JSONValue>(
  eventName: string,
): [T | undefined, (value: T) => void] {
  // This is a placeholder - the actual implementation depends on React
  // Fragments can import from react and implement this themselves
  const bus = getBus();
  return [bus.latestValue<T>(eventName), (value: T) => bus.dispatch(eventName, value)];
}

/**
 * Subscribe to a message bus event with a callback
 * Returns a cleanup function
 */
export function subscribe<T extends JSONValue>(
  eventName: string,
  callback: MessageBusCallback<T>,
): () => void {
  return getBus().listen(eventName, callback);
}

/**
 * Dispatch an event to the message bus
 */
export function dispatch(eventName: string, value: JSONValue): void {
  getBus().dispatch(eventName, value);
}
