import type { Server, ServerWebSocket } from "bun";
import type { Hono, MiddlewareHandler } from "hono";

/**
 * Plugin configuration (Babel-style):
 * - string: plugin name without config (e.g., "@buntime/metrics")
 * - tuple: [name, config] (e.g., ["@buntime/authn", { provider: "keycloak" }])
 */
export type PluginConfig = string | [name: string, config: Record<string, unknown>];

/**
 * Buntime global configuration (buntime.jsonc)
 */
export interface BuntimeConfig {
  /**
   * Plugins to load (Babel-style array, order matters!)
   * @example
   * [
   *   "@buntime/metrics",
   *   ["@buntime/authn", { "provider": "keycloak" }]
   * ]
   */
  plugins?: PluginConfig[];

  /**
   * Plugins that cannot be disabled by apps
   */
  required?: string[];
}

/**
 * Context provided to plugins during initialization
 */
export interface PluginContext {
  /** Plugin-specific configuration */
  config: Record<string, unknown>;

  /** Logger instance */
  logger: PluginLogger;

  /** Access to worker pool (if needed) */
  pool?: unknown;
}

/**
 * Logger interface for plugins
 */
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
}

/**
 * Information about the app being accessed
 */
export interface AppInfo {
  /** App name (e.g., "my-app") */
  name: string;

  /** App version (e.g., "1.0.0") */
  version: string;

  /** Absolute path to app directory */
  dir: string;

  /** App-specific worker configuration */
  config: WorkerConfig;
}

/**
 * Worker configuration from worker.jsonc (per-app)
 */
export interface WorkerConfig {
  autoInstall?: boolean;
  entrypoint?: string;
  idleTimeout?: number;
  lowMemory?: boolean;
  maxRequests?: number;
  timeout?: number;
  ttl?: number;
}

/**
 * Worker instance interface (for plugin hooks)
 */
export interface WorkerInstance {
  id: string;
  app: string;
  version: string;
  status: "active" | "idle" | "terminated";
  stats: WorkerStats;
}

/**
 * Worker statistics
 */
export interface WorkerStats {
  age: number;
  idle: number;
  requestCount: number;
  status: "active" | "idle" | "terminated";
}

/**
 * Plugin definition
 */
export interface BuntimePlugin {
  /** Unique plugin name (e.g., "@buntime/metrics") */
  name: string;

  /** Plugin version (semver) */
  version: string;

  /**
   * Dependencies on other plugins
   * These plugins must be loaded before this one
   */
  dependencies?: string[];

  /**
   * Execution priority (lower = earlier)
   * If not set, uses array order from config
   */
  priority?: number;

  /**
   * Called when plugin is initialized
   */
  onInit?: (ctx: PluginContext) => Promise<void> | void;

  /**
   * Called when buntime is shutting down
   */
  onShutdown?: () => Promise<void> | void;

  /**
   * Called after Bun.serve() starts
   * Use this to get access to the server instance (e.g., for WebSocket upgrades)
   */
  onServerStart?: (server: Server<unknown>) => void;

  /**
   * WebSocket handler for Bun.serve()
   * If provided, will be merged with other plugin WebSocket handlers
   */
  websocket?: {
    close?: (ws: ServerWebSocket<unknown>, code: number, reason: string) => void;
    message?: (ws: ServerWebSocket<unknown>, message: string | Buffer) => void;
    open?: (ws: ServerWebSocket<unknown>) => void;
  };

  /**
   * Called for each incoming request (before worker)
   * Return:
   * - Request: modified request to continue pipeline
   * - Response: short-circuit and return immediately
   * - void/undefined: continue with original request
   */
  onRequest?: (
    req: Request,
    app: AppInfo,
  ) => Promise<Request | Response | void> | Request | Response | void;

  /**
   * Called after response is generated (before sending to client)
   * Return modified response
   */
  onResponse?: (res: Response, app: AppInfo) => Promise<Response> | Response;

  /**
   * Called when a worker is spawned
   */
  onWorkerSpawn?: (worker: WorkerInstance, app: AppInfo) => void;

  /**
   * Called when a worker is terminated
   */
  onWorkerTerminate?: (worker: WorkerInstance, app: AppInfo) => void;

  /**
   * Internal routes for the plugin (mounted at /_/{plugin-name}/*)
   */
  routes?: Hono;

  /**
   * Alternative to onRequest - Hono middleware
   */
  middleware?: MiddlewareHandler;
}

/**
 * Plugin factory function type
 */
export type PluginFactory = (
  config?: Record<string, unknown>,
) => BuntimePlugin | Promise<BuntimePlugin>;

/**
 * Plugin module export type
 */
export type PluginModule =
  | BuntimePlugin
  | PluginFactory
  | { default: BuntimePlugin | PluginFactory };
