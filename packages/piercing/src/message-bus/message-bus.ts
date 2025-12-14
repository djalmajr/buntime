import type { JSONValue, MessageBus, MessageBusCallback, MessageBusState } from "../types";

/**
 * Wildcard callback receives event name as second parameter
 */
export type WildcardCallback = (value: JSONValue, eventName: string) => void;

/**
 * Generic message bus implementation that works on both server and client
 */
export class GenericMessageBus implements MessageBus {
  protected _callbacksMap = new Map<string, MessageBusCallback<JSONValue>[]>();
  protected _wildcardCallbacks: WildcardCallback[] = [];

  constructor(protected _state: MessageBusState = {}) {}

  get state(): MessageBusState {
    // Return a deep copy to prevent external mutation
    return JSON.parse(JSON.stringify(this._state));
  }

  dispatch(eventName: string, value: JSONValue): void {
    this._state[eventName] = value;
    const callbacks = this._callbacksMap.get(eventName) ?? [];

    // Dispatch asynchronously to avoid blocking
    queueMicrotask(() => {
      // Call specific listeners
      for (const callback of callbacks) {
        callback(value);
      }

      // Call wildcard listeners
      for (const callback of this._wildcardCallbacks) {
        callback(value, eventName);
      }
    });
  }

  listen<T extends JSONValue>(eventName: string, callback: MessageBusCallback<T>): () => void {
    // Handle wildcard listener
    if (eventName === "*") {
      const wildcardCallback = callback as unknown as WildcardCallback;
      this._wildcardCallbacks.push(wildcardCallback);

      return () => {
        this._wildcardCallbacks = this._wildcardCallbacks.filter((cb) => cb !== wildcardCallback);
      };
    }

    // If there's already a value, call the callback immediately
    const latestValue = this.latestValue<T>(eventName);
    if (latestValue !== undefined) {
      queueMicrotask(() => callback(latestValue));
    }

    // Add callback to the map
    if (!this._callbacksMap.has(eventName)) {
      this._callbacksMap.set(eventName, []);
    }
    this._callbacksMap.get(eventName)!.push(callback as MessageBusCallback<JSONValue>);

    // Return cleanup function
    return () => {
      const callbacks = this._callbacksMap.get(eventName) ?? [];
      const filtered = callbacks.filter((cb) => cb !== callback);
      if (filtered.length > 0) {
        this._callbacksMap.set(eventName, filtered);
      } else {
        this._callbacksMap.delete(eventName);
      }
    };
  }

  latestValue<T extends JSONValue>(eventName: string): T | undefined {
    return this._state[eventName] as T | undefined;
  }
}
