import type { JSONValue } from "../types";

/**
 * Sandbox strategy type
 * - "patch": Monkey-patches history API to intercept navigation
 * - "isolate": Full iframe isolation with postMessage communication
 */
export type SandboxStrategy = "patch" | "isolate";

/**
 * Configuration for sandbox strategies
 */
export interface SandboxConfig {
  /** URL being loaded */
  src: string;

  /** Fragment identifier - REQUIRED */
  fragmentId: string;

  /** Sandbox strategy to use */
  strategy: SandboxStrategy;

  /** Mount path in the shell (e.g., "/cpanel/external") - REQUIRED */
  mountPath: string;

  /** External origin (optional, used for iframe strategy) */
  origin?: string;

  /** Allow MessageBus communication */
  allowMessageBus?: boolean;

  /** Styles to inject before fragment loads */
  preloadStyles?: string;
}

/**
 * Navigation event from sandboxed fragment
 */
export interface SandboxNavigateEvent {
  [key: string]: JSONValue;
  action: "push" | "replace" | "pop";
  fragmentId: string;
  state: JSONValue;
  url: string;
}

/**
 * Interface that all sandbox strategies must implement
 */
export interface SandboxStrategyHandler {
  /** Initialize the sandbox before loading fragment */
  init(): void | Promise<void>;

  /** Clean up when fragment is removed */
  cleanup(): void;

  /** Handle navigation events from the fragment */
  onNavigate?(event: SandboxNavigateEvent): void;
}

/**
 * Factory function type for creating sandbox handlers
 */
export type SandboxStrategyFactory = (config: SandboxConfig) => SandboxStrategyHandler;
