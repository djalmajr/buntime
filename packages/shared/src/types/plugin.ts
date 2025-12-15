import type { BunFile, Server, ServerWebSocket } from "bun";
import type { Hono, MiddlewareHandler } from "hono";

/**
 * Route handler type for Bun.serve routes
 */
export type RouteHandler = Response | BunFile | ((req: Request) => Response | Promise<Response>);

/**
 * Menu item for plugin navigation in the shell (C-Panel)
 * Supports nested menus via `items` property
 */
export interface MenuItem {
  /** Display title */
  title: string;

  /** Icon identifier (e.g., "lucide:scroll-text") */
  icon: string;

  /** Route path (e.g., "/logs") */
  path: string;

  /** Sort priority (lower = earlier in menu) */
  priority?: number;

  /** Nested menu items */
  items?: MenuItem[];
}

/**
 * Sandbox strategy for fragment isolation
 *
 * - "none": No sandbox, fragment shares context with shell (default for internal plugins)
 * - "monkey-patch": Intercepts History API, prevents URL changes (lightweight)
 * - "iframe": Full isolation via iframe (for untrusted external apps)
 * - "service-worker": Intercepts all requests, injects sandbox script (for external apps needing shared styles)
 */
export type SandboxStrategy = "none" | "monkey-patch" | "iframe" | "service-worker";

/**
 * Fragment sandbox type (excludes "none" - if no sandbox needed, don't define fragment)
 */
export type FragmentType = "monkey-patch" | "iframe" | "service-worker";

/**
 * Fragment configuration for plugins that can be embedded in the shell
 */
export interface FragmentOptions {
  /**
   * Sandbox type for isolating the fragment
   * - "monkey-patch": Intercepts History API (lightweight, recommended for most cases)
   * - "iframe": Full isolation via iframe (for untrusted external apps)
   * - "service-worker": Intercepts all requests (for external apps needing shared styles)
   */
  type: FragmentType;

  /**
   * External origin for iframe/service-worker types
   * Required when type is "iframe" or "service-worker"
   * @example "https://legacy-app.company.com"
   */
  origin?: string;

  /**
   * Custom styles to inject before fragment loads (reduces flash)
   * @example "body { opacity: 0; transition: opacity 0.2s; }"
   */
  preloadStyles?: string;
}

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
   * Homepage app to serve when no worker matches
   * This app typically orchestrates micro-frontends via fragments
   * Format: "app-name@version" or "app-name" (uses latest)
   * @example "cpanel" or "dashboard@1"
   */
  homepage?: string;

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
   * Maximum number of workers in the pool
   * @default 100
   */
  poolSize?: number;

  /**
   * Workspace directories containing worker apps
   * Supports ${ENV_VAR} syntax
   * @example ["./apps", "../examples"] or ["${WORKSPACES_DIR}"]
   */
  workspaces?: string[];
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
  /** Maximum number of workers in the pool */
  poolSize: number;

  /** Workspace directories containing worker apps (normalized to array) */
  workspaces: string[];
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
/**
 * App visibility in the deployments UI
 * - "public": visible and editable (default)
 * - "protected": visible but read-only
 * - "internal": hidden from UI
 */
export type AppVisibility = "internal" | "protected" | "public";

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

  /**
   * App visibility in the deployments UI
   * @default "public"
   */
  visibility?: AppVisibility;
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
   * All routes are mounted at /{base}/*
   * @default `/{plugin-short-name}` (e.g., "@buntime/plugin-keyval" → "/keyval")
   * @example "/kv" or "/custom-path"
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
   * Hono routes for the plugin API
   * Mounted at /{base}/* (e.g., "/keyval/api/*")
   */
  routes?: Hono;

  /**
   * Alternative to onRequest - Hono middleware
   */
  middleware?: MiddlewareHandler;

  /**
   * Server module for serving static files and API routes in main process
   * - routes: goes to Bun.serve({ routes }) with auth wrapper
   * - fetch: invoked in app.fetch (Hono)
   */
  server?: PluginServer;

  /**
   * Fragment configuration for embedding this plugin in the shell (C-Panel)
   * The plugin's UI is served from its base path and "pierced" into the shell
   *
   * If not defined, the plugin has no fragment (API-only plugin)
   *
   * @example
   * // Monkey-patch for internal plugins (recommended)
   * fragment: {
   *   type: "monkey-patch",
   * }
   *
   * @example
   * // Full isolation with iframe for untrusted external apps
   * fragment: {
   *   type: "iframe",
   *   origin: "https://external-app.com",
   * }
   *
   * @example
   * // Service worker for external apps needing shared styles
   * fragment: {
   *   type: "service-worker",
   *   origin: "https://legacy-app.com",
   * }
   */
  fragment?: FragmentOptions;

  /**
   * Menu items for the shell navigation (C-Panel sidebar)
   * Supports nested menus via `items` property
   *
   * @example
   * menus: [
   *   { title: "Logs", icon: "lucide:scroll-text", path: "/logs" },
   *   {
   *     title: "Reports",
   *     icon: "lucide:file-text",
   *     path: "/reports",
   *     items: [
   *       { title: "Daily", icon: "lucide:calendar", path: "/reports/daily" },
   *     ],
   *   },
   * ]
   */
  menus?: MenuItem[];
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
