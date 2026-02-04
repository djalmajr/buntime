import type { BunFile, Server, ServerWebSocket } from "bun";
import type { Hono, MiddlewareHandler } from "hono";

/**
 * Route handler type for Bun.serve routes
 */
export type RouteHandler = Response | BunFile | ((req: Request) => Response | Promise<Response>);

// ============================================================================
// Config Schema Types (for manifest.yaml)
// ============================================================================

/**
 * Supported config value types in manifest.yaml
 */
export type ConfigType = "string" | "number" | "boolean" | "enum" | "array" | "password" | "object";

/**
 * Base config field properties shared by all types
 */
export interface ConfigFieldBase {
  /** Field type */
  type: ConfigType;
  /** Display label in Rancher UI */
  label: string;
  /** Description/help text */
  description?: string;
  /** Environment variable name (e.g., GATEWAY_SHELL_DIR) */
  env?: string;
  /** Whether field is required */
  required?: boolean;
  /** Example value for documentation */
  example?: string;
}

/**
 * String config field
 */
export interface ConfigFieldString extends ConfigFieldBase {
  type: "string";
  default?: string;
}

/**
 * Password config field (masked in UI)
 */
export interface ConfigFieldPassword extends ConfigFieldBase {
  type: "password";
  default?: string;
}

/**
 * Number config field
 */
export interface ConfigFieldNumber extends ConfigFieldBase {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
}

/**
 * Boolean config field
 */
export interface ConfigFieldBoolean extends ConfigFieldBase {
  type: "boolean";
  default?: boolean;
}

/**
 * Enum config field (dropdown)
 */
export interface ConfigFieldEnum extends ConfigFieldBase {
  type: "enum";
  default?: string;
  options: string[];
}

/**
 * Array config field (multiline in Rancher)
 */
export interface ConfigFieldArray extends ConfigFieldBase {
  type: "array";
  default?: string[];
}

/**
 * Object config field (nested properties)
 */
export interface ConfigFieldObject extends ConfigFieldBase {
  type: "object";
  properties: Record<string, ConfigField>;
}

/**
 * Union of all config field types
 */
export type ConfigField =
  | ConfigFieldString
  | ConfigFieldPassword
  | ConfigFieldNumber
  | ConfigFieldBoolean
  | ConfigFieldEnum
  | ConfigFieldArray
  | ConfigFieldObject;

/**
 * Plugin configuration schema
 * Maps config key to field definition
 */
export type ConfigSchema = Record<string, ConfigField>;

// ============================================================================
// Menu and Plugin Types
// ============================================================================

/**
 * Menu item for plugin navigation in the shell (C-Panel)
 * Supports nested menus via `items` property
 * Order is determined by plugin load order (topological sort by dependencies)
 */
export interface MenuItem {
  /** Display title */
  title: string;

  /** Icon identifier (e.g., "lucide:scroll-text") */
  icon: string;

  /** Route path (e.g., "/logs") */
  path: string;

  /** Nested menu items */
  items?: MenuItem[];
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
 * Buntime global configuration (environment variables)
 */
export interface BuntimeConfig {
  /**
   * Global body size limits for request payloads
   * Workers can configure their own limit up to max
   *
   * @example
   * { default: "10mb", max: "100mb" }
   */
  bodySize?: {
    /** Default body size limit for all workers */
    default?: number | string;
    /** Maximum allowed body size (ceiling for per-worker config) */
    max?: number | string;
  };

  /**
   * Directories to scan for plugins
   * Supports ${ENV_VAR} syntax
   * @default ["./plugins"]
   * @example ["./plugins", "${EXTERNAL_PLUGINS_DIR}"]
   */
  pluginDirs?: string[];

  /**
   * Maximum number of workers in the pool
   * @default 100
   */
  poolSize?: number;

  /**
   * Worker directories containing worker apps
   * Supports ${ENV_VAR} syntax
   * @example ["./apps", "../examples"] or ["${WORKER_DIRS}"]
   */
  workerDirs?: string[];
}

/**
 * Base configuration shared by all plugins with routes
 */
export interface BasePluginConfig {
  /**
   * Override the default base path for plugin routes
   * @example "/kv" to use /kv instead of /keyval
   */
  base?: string;
}

/**
 * Global configuration values available to all plugins
 */
export interface GlobalPluginConfig {
  /** Maximum number of workers in the pool */
  poolSize: number;

  /** Worker directories containing worker apps (normalized to array) */
  workerDirs: string[];
}

/**
 * Context provided to plugins during initialization
 */
export interface PluginContext {
  /** Plugin-specific configuration */
  config: Record<string, unknown>;

  /**
   * Global configuration from environment variables
   * Provides access to shared values like workerDirs, poolSize
   */
  globalConfig: GlobalPluginConfig;

  /** Logger instance */
  logger: PluginLogger;

  /** Access to worker pool (if needed) */
  pool?: unknown;

  /**
   * Get exports from another plugin by its manifest name
   * @param pluginName Plugin manifest name (e.g., "@buntime/plugin-database")
   * @returns The plugin's exported object or undefined if not registered
   *
   * @example
   * const database = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
   * const kv = ctx.getPlugin<Kv>("@buntime/plugin-keyval");
   */
  getPlugin<T>(pluginName: string): T | undefined;

  /**
   * Runtime information for service discovery
   * Same data exposed at /.well-known/buntime
   */
  runtime: {
    /** Runtime API path (e.g., "/api" or "/_/api") */
    api: string;
    /** Runtime version */
    version: string;
  };
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

// Re-export worker config types from centralized module
export type {
  AppVisibility,
  WorkerConfig,
  WorkerManifest,
} from "../utils/worker-config";
export { parseWorkerConfig, WorkerConfigDefaults } from "../utils/worker-config";

import type { WorkerManifest } from "../utils/worker-config";

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

  /** App-specific worker configuration (human-readable format) */
  config: WorkerManifest;
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
 * Different from workerDirs: no version convention, direct path mapping
 */
export interface PluginApp {
  /** Filesystem directory containing the app */
  dir: string;

  /** Optional worker config overrides (human-readable format) */
  config?: Partial<WorkerManifest>;

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
 * Plugin manifest from manifest.yaml
 * Contains all metadata and configuration (no code)
 */
export interface PluginManifest {
  /** Unique plugin identifier (e.g., "@buntime/plugin-keyval") */
  name: string;

  /** Enable/disable the plugin (default: true) */
  enabled?: boolean;

  /**
   * Base path for plugin routes
   * All routes are mounted at /{base}/*
   * @example "/keyval" or "/auth"
   */
  base: string;

  /** Path to compiled client entrypoint */
  entrypoint?: string;

  /**
   * Path to plugin entrypoint (server-side code: middlewares, hooks, routes)
   * If not specified, loader tries: plugin.{ts,js}, index.{ts,js} in root
   * @example "dist/plugin.js"
   */
  pluginEntry?: string;

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
   * Menu items for the shell navigation (C-Panel sidebar)
   * Supports nested menus via `items` property
   * Order is determined by plugin load order (topological sort)
   */
  menus?: MenuItem[];

  /**
   * Configuration schema for Helm questions.yml generation
   * Defines configurable options exposed in Rancher UI
   * @example
   * config:
   *   appShell:
   *     type: string
   *     label: App Shell Path
   *     env: GATEWAY_SHELL_DIR
   */
  config?: ConfigSchema;

  /** Plugin-specific configuration (passed to factory function) */
  [key: string]: unknown;
}

/**
 * Plugin implementation (code only)
 * Returned by plugin.ts factory function
 */
export interface PluginImpl {
  /** Alternative to onRequest - Hono middleware */
  middleware?: MiddlewareHandler;

  /**
   * Hono routes for the plugin API
   * Mounted at /{base}/* (e.g., "/keyval/api/*")
   */
  routes?: Hono;

  /**
   * Server module for serving static files and API routes in main process
   * - routes: goes to Bun.serve({ routes }) with auth wrapper
   * - fetch: invoked in app.fetch (Hono)
   */
  server?: PluginServer;

  /**
   * WebSocket handler for Bun.serve()
   * If provided, will be merged with other plugin WebSocket handlers
   */
  websocket?: {
    close?: (ws: ServerWebSocket<unknown>, code: number, reason: string) => void;
    message?: (ws: ServerWebSocket<unknown>, message: string | Buffer) => void;
    open?: (ws: ServerWebSocket<unknown>) => void;
  };

  /** Called when plugin is initialized */
  onInit?: (ctx: PluginContext) => Promise<void> | void;

  /**
   * Exports provided by this plugin for other plugins to use.
   * Called AFTER onInit completes. The returned value is registered
   * with the plugin's manifest name as the key.
   *
   * Other plugins can access via: ctx.getPlugin("@buntime/plugin-xxx")
   *
   * @returns Value to expose to other plugins (typically an object or service instance)
   *
   * @example
   * // In plugin-database - expose service instance directly
   * provides: () => databaseService
   *
   * // In plugin-logs - expose multiple functions
   * provides: () => ({ addLog, clearLogs, getLogs })
   *
   * // In another plugin
   * const db = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
   * db?.query("SELECT * FROM users");
   */
  provides?: () => unknown | Promise<unknown>;

  /** Called when buntime is shutting down */
  onShutdown?: () => Promise<void> | void;

  /**
   * Called after Bun.serve() starts
   * Use this to get access to the server instance (e.g., for WebSocket upgrades)
   */
  onServerStart?: (server: Server<unknown>) => void;

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

  /** Called when a worker is spawned */
  onWorkerSpawn?: (worker: WorkerInstance, app: AppInfo) => void;

  /** Called when a worker is terminated */
  onWorkerTerminate?: (worker: WorkerInstance, app: AppInfo) => void;
}

/**
 * Combined plugin (manifest + implementation)
 * Used internally by loader after merging manifest with implementation
 */
export type BuntimePlugin = PluginManifest & PluginImpl;

/**
 * Plugin implementation factory function type
 * Receives plugin-specific config from manifest.yaml
 */
export type PluginImplFactory = (
  config?: Record<string, unknown>,
) => PluginImpl | Promise<PluginImpl>;

/**
 * Plugin module export type (from plugin.ts)
 */
export type PluginModule =
  | PluginImpl
  | PluginImplFactory
  | { default: PluginImpl | PluginImplFactory };

/**
 * @deprecated Use PluginImplFactory instead
 */
export type PluginFactory = PluginImplFactory;
