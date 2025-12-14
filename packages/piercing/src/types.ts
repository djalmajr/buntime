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
 * Configuration for a fragment
 */
export interface FragmentConfig {
  /** Unique identifier for the fragment */
  fragmentId: string;

  /**
   * Function to fetch fragment SSR content
   * Receives the (possibly transformed) request
   */
  fetchFragment: (request: Request) => Promise<Response>;

  /** Framework used by the fragment (for optimizations) */
  framework?: "react" | "qwik" | "solid" | "vue";

  /** CSS styles applied before piercing for seamless transitions */
  prePiercingStyles?: string;

  /** Routes where this fragment should be pre-pierced in HTML */
  prePierceRoutes?: string[];

  /** Function to serve fragment static assets */
  serveAssets?: (request: Request) => Promise<Response>;

  /**
   * Determine if this fragment should be included in the response
   * Use for auth checks, feature flags, A/B testing, etc.
   * Returns true to include, false to skip
   */
  shouldBeIncluded?: (request: Request) => boolean | Promise<boolean>;

  /**
   * Transform the request before passing to fetchFragment
   * Use for URL rewriting, adding query params, etc.
   */
  transformRequest?: (request: Request) => Request | Promise<Request>;
}

/**
 * Configuration for the piercing gateway
 */
export interface PiercingGatewayConfig {
  /** Function to get the shell HTML */
  getShellHtml: (request: Request) => Promise<string>;
  /** Function to generate initial message bus state */
  generateMessageBusState?: (
    requestState: MessageBusState,
    request: Request,
  ) => MessageBusState | Promise<MessageBusState>;
  /** Function to determine if piercing should be enabled for a request */
  shouldPiercingBeEnabled?: (request: Request) => boolean | Promise<boolean>;
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
