import type { JSONValue } from "../types";

/**
 * Sandbox strategy type
 */
export type SandboxStrategy = "none" | "monkey-patch" | "iframe" | "service-worker";

/**
 * Configuration for sandbox strategies
 */
export interface SandboxConfig {
  /** Fragment identifier */
  fragmentId: string;

  /** Sandbox strategy to use */
  strategy: SandboxStrategy;

  /** External origin (required for iframe/service-worker) */
  origin?: string;

  /** Mount path in the shell (e.g., "/cpanel/external") */
  mountPath: string;

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
