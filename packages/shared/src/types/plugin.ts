import type { FragmentConfig } from "@buntime/piercing";
import type { BunFile, Server, ServerWebSocket } from "bun";
import type { Hono, MiddlewareHandler } from "hono";

/**
 * Route handler type for Bun.serve routes
 */
export type RouteHandler = Response | BunFile | ((req: Request) => Response | Promise<Response>);

/**
 * Plugin server configuration
 * Allows plugins to serve static files and API routes directly in main process
 */
export interface PluginServer {
  /**
   * Routes for Bun.serve({ routes })
   * These are wrapped with auth check based on publicRoutes
   * @example { "/login": htmlFile, "/api/health/*": () => new Response("OK") }
   */
  routes?: Record<string, RouteHandler>;

  /**
   * Fetch handler invoked in app.fetch
   * Called after routes don't match, before Hono routes
   * @example honoApp.fetch
   */
  fetch?: (req: Request) => Response | Promise<Response>;
}

/**
 * Public routes configuration per HTTP method
 * ALL applies to all methods, others are method-specific
 *
 * @example
 * // Array format - applies to ALL methods
 * publicRoutes: ["/health", "/api/public/**"]
 *
 * @example
 * // Object format - method-specific
 * publicRoutes: {
 *   ALL: ["/health"],
 *   GET: ["/api/users/**"],
 *   POST: ["/api/webhook"]
 * }
 */
export type PublicRoutesConfig =
  | string[]
  | {
      ALL?: string[];
      DELETE?: string[];
      GET?: string[];
      HEAD?: string[];
      OPTIONS?: string[];
      PATCH?: string[];
      POST?: string[];
      PUT?: string[];
    };

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
   * Directory containing worker apps
   * Supports ${ENV_VAR} syntax
   * @example "/var/buntime/apps" or "${APPS_DIR}"
   */
  appsDir?: string;

  /**
   * Maximum number of workers in the pool
   * @default 100
   */
  poolSize?: number;

  /**
   * Default shell app to serve when no worker matches
   * Format: "app-name@version" or "app-name" (uses latest)
   * @example "example-spa@1" or "cpanel"
   */
  shell?: string;

  /**
   * Plugins to load (Babel-style array, order matters!)
   * @example
   * [
   *   "@buntime/metrics",
   *   ["@buntime/authn", { "provider": "keycloak" }]
   * ]
   */
  plugins?: PluginConfig[];
}

/**
 * Base configuration shared by all plugins with routes
 */
export interface BasePluginConfig {
  /**
   * Custom base path for plugin routes
   * @default `/api/{plugin-short-name}`
   * @example "/api/kv" or "/kv"
   */
  base?: string;
}

/**
 * Global configuration values available to all plugins
 */
export interface GlobalPluginConfig {
  /** Directory containing worker apps */
  appsDir: string;

  /** Maximum number of workers in the pool */
  poolSize: number;
}

/**
 * Context provided to plugins during initialization
 */
export interface PluginContext {
  /** Plugin-specific configuration */
  config: Record<string, unknown>;

  /**
   * Global configuration from buntime.jsonc
   * Provides access to shared values like appsDir, poolSize
   */
  globalConfig: GlobalPluginConfig;

  /** Logger instance */
  logger: PluginLogger;

  /** Access to worker pool (if needed) */
  pool?: unknown;

  /**
   * Register a service for other plugins to use
   * @param name Service name (e.g., "kv", "cache")
   * @param service The service instance
   */
  registerService<T>(name: string, service: T): void;

  /**
   * Get a service registered by another plugin
   * @param name Service name
   * @returns The service instance or undefined if not registered
   */
  getService<T>(name: string): T | undefined;
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

  /**
   * Routes that bypass plugin onRequest hooks
   * Routes are relative to the worker's base path (e.g., "/api/health" → "/{app}/api/health")
   * Supports wildcards: * (single segment), ** (multiple segments)
   */
  publicRoutes?: PublicRoutesConfig;

  timeout?: number;
  ttl?: number;

  /**
   * Additional environment variables to pass to the worker
   */
  env?: Record<string, string>;
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
 * App registered by a plugin (served as worker)
 * Different from APPS_DIR: no version convention, direct path mapping
 */
export interface PluginApp {
  /** Filesystem directory containing the app */
  dir: string;

  /** Optional worker config overrides */
  config?: Partial<WorkerConfig>;

  /**
   * URL path for this app (e.g., "/login", "/dashboard")
   * @deprecated Use `routes` instead for explicit route matching
   */
  path?: string;

  /**
   * Routes that this app handles (glob patterns)
   * Required for apps that need explicit route matching
   * @example ["/login", "/register", "/api/auth/**"]
   */
  routes?: string[];
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
   * Required dependencies on other plugins
   * These plugins must be loaded before this one
   * Throws error if dependency is not configured
   */
  dependencies?: string[];

  /**
   * Optional dependencies on other plugins
   * If available, these plugins will be loaded before this one
   * Does not throw if dependency is not configured
   */
  optionalDependencies?: string[];

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
   * - undefined: continue with original request
   */
  onRequest?: (
    req: Request,
    app?: AppInfo,
  ) => Promise<Request | Response | undefined> | Request | Response | undefined;

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
   * Custom base path for plugin routes
   * @default `/api/{plugin-short-name}`
   * @example "/api/kv" or "/kv"
   */
  base?: string;

  /**
   * Routes that bypass this plugin's onRequest hook
   * These are absolute paths (not relative to base)
   * Supports wildcards: * (single segment), ** (multiple segments)
   * @example { ALL: ["/health"], GET: ["/api/public/**"] }
   */
  publicRoutes?: PublicRoutesConfig;

  /**
   * Internal routes for the plugin
   * Mounted at `base` or `/api/{plugin-short-name}/*` by default
   */
  routes?: Hono;

  /**
   * Alternative to onRequest - Hono middleware
   */
  middleware?: MiddlewareHandler;

  /**
   * Apps to register as workers
   * These are served from the plugin's directory, not APPS_DIR
   * Path is relative to base (e.g., "/login" → "/api/authn/login")
   */
  apps?: PluginApp[];

  /**
   * Server module for serving static files and API routes in main process
   * - routes: goes to Bun.serve({ routes }) with auth wrapper
   * - fetch: invoked in app.fetch (Hono)
   */
  server?: PluginServer;

  /**
   * Micro-frontend fragment configuration for piercing architecture
   * Allows plugins to provide UI fragments that get "pierced" into the main shell
   *
   * @example
   * fragment: {
   *   fragmentId: "deployments",
   *   prePierceRoutes: ["/cpanel/deployments*"],
   *   fetchFragment: (req) => deploymentWorker.fetch(req),
   * }
   */
  fragment?: Omit<FragmentConfig, "fragmentId"> & { fragmentId?: string };
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
