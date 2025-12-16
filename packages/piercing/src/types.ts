/**
 * JSON-serializable value types for message bus state
 */
export type JSONValue =
  | null
  | string
  | number
  | boolean
  | { [x: string]: JSONValue }
  | Array<JSONValue>;

/**
 * Message bus state - a record of event names to their latest values
 */
export type MessageBusState = Record<string, JSONValue>;

/**
 * Callback function for message bus events
 */
export type MessageBusCallback<T extends JSONValue> = (value: T) => void;

/**
 * Interface for isomorphic message bus (works on server and client)
 */
export interface MessageBus {
  /** The current state of the message bus */
  readonly state: MessageBusState;

  /**
   * Dispatch an event with a value
   * @param eventName - The event name
   * @param value - The value to dispatch (must be JSON-serializable)
   */
  dispatch(eventName: string, value: JSONValue): void;

  /**
   * Listen for an event
   * @param eventName - The event name to listen for
   * @param callback - Function called when event is dispatched
   * @returns Cleanup function to remove the listener
   */
  listen<T extends JSONValue>(eventName: string, callback: MessageBusCallback<T>): () => void;

  /**
   * Get the latest value for an event
   * @param eventName - The event name
   * @returns The latest value or undefined if not set
   */
  latestValue<T extends JSONValue>(eventName: string): T | undefined;
}

/**
 * Navigation item registered by a fragment plugin
 */
export interface NavigationItem {
  /** Display title */
  title: string;
  /** Icon identifier (e.g., "lucide:home") */
  icon: string;
  /** Route path */
  path: string;
  /** Sort priority (lower = earlier) */
  priority?: number;
}
