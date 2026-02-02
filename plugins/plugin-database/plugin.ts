import type { PluginContext, PluginImpl, PluginLogger } from "@buntime/shared/types";
import type { Server } from "bun";
import manifest from "./manifest.yaml";
import {
  api,
  handleWebSocketRequest,
  hranaWebSocketHandler,
  setServer,
  setService,
} from "./server/api";
import type { HranaWebSocketData } from "./server/hrana/websocket";
import { DatabaseServiceImpl } from "./server/service";
import type { AdapterConfig, DatabasePluginConfig } from "./server/types";

let service: DatabaseServiceImpl | null = null;
let logger: PluginLogger;

/**
 * Auto-detect libSQL URLs from environment variables.
 *
 * Convention:
 * - DATABASE_LIBSQL_URL: Primary URL (required for writes)
 * - DATABASE_LIBSQL_REPLICAS: Comma-separated replica URLs (optional, for read scaling)
 */
function detectLibSqlUrls(): string[] {
  const urls: string[] = [];

  // Primary URL (required)
  const primaryUrl = process.env.DATABASE_LIBSQL_URL;
  if (primaryUrl) {
    urls.push(primaryUrl);
  }

  // Replica URLs (optional): comma-separated list
  const replicas = process.env.DATABASE_LIBSQL_REPLICAS;
  if (replicas) {
    const replicaUrls = replicas
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    urls.push(...replicaUrls);
  }

  return urls;
}

/**
 * Process a single adapter config (values come from ConfigMap or manifest)
 */
function processAdapter(adapter: AdapterConfig, log: PluginLogger): AdapterConfig {
  const processed = { ...adapter, logger: log };

  // Auto-detect libSQL URLs from environment and merge with config
  if (processed.type === "libsql") {
    const envUrls = detectLibSqlUrls();
    const configUrls = (processed as { urls?: string[] }).urls ?? [];

    // Merge: config urls first, then env urls (deduplicated via Set)
    const allUrls = [...new Set([...configUrls, ...envUrls])];

    if (allUrls.length > 0) {
      (processed as { urls: string[] }).urls = allUrls;
    }
  }

  return processed;
}

/**
 * Process config to normalize adapters array
 */
function processConfig(config: DatabasePluginConfig, log: PluginLogger): DatabasePluginConfig {
  const processed = { ...config };

  // Process adapters array
  if (config.adapters && config.adapters.length > 0) {
    processed.adapters = config.adapters.map((a) => processAdapter(a, log));
  }

  return processed;
}

/**
 * Database plugin for Buntime
 *
 * Provides a database abstraction layer with multi-tenancy support.
 * Other plugins can depend on this to get database access.
 *
 * Supports multiple adapters - each plugin can choose which to use.
 *
 * @example Multiple adapters - each plugin has its own manifest.yaml
 * ```yaml
 * # plugins/plugin-database/manifest.yaml
 * name: "@buntime/plugin-database"
 * enabled: true
 * adapters:
 *   - type: libsql
 *     default: true
 *     urls:
 *       - http://localhost:8880
 *   - type: sqlite
 *     url: file:./auth.db
 * ```
 *
 * ```yaml
 * # plugins/plugin-keyval/manifest.yaml
 * name: "@buntime/plugin-keyval"
 * enabled: true
 * database: libsql
 * ```
 *
 * ```yaml
 * # plugins/plugin-authn/manifest.yaml
 * name: "@buntime/plugin-authn"
 * enabled: true
 * database: sqlite
 * ```
 */
export default function databasePlugin(config: DatabasePluginConfig = {}): PluginImpl {
  const base = config.base ?? manifest.base;

  return {
    // API routes run on main thread
    routes: api,

    // WebSocket handler for HRANA protocol
    websocket: hranaWebSocketHandler as PluginImpl["websocket"],

    // Expose database service for other plugins
    provides: () => service,

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      // Process config with env var substitution
      const processedConfig = processConfig(config, logger);

      // Create service
      service = new DatabaseServiceImpl({
        config: processedConfig,
        logger,
      });

      // Set service for API routes (with base path for WebSocket)
      setService(service, logger, base);

      logger.info("Database plugin initialized");
    },

    onServerStart(server) {
      // Set server for WebSocket upgrades
      setServer(server as Server<HranaWebSocketData>);
      logger?.debug("Database plugin server configured for HRANA WebSocket");
    },

    async onRequest(req) {
      // Handle WebSocket upgrade requests for HRANA
      const result = handleWebSocketRequest(req);
      if (result) {
        return result;
      }
      return undefined;
    },

    async onShutdown() {
      await service?.close();
      service = null;
    },
  };
}

// Named exports
export { databasePlugin };
export { BunSqlAdapter } from "./server/adapters/bun-sql";
export { LibSqlAdapter } from "./server/adapters/libsql";
export { DatabaseServiceImpl } from "./server/service";
export type {
  AdapterConfig,
  AdapterType,
  BunSqlAdapterConfig,
  DatabaseAdapter,
  DatabasePluginConfig,
  DatabaseService,
  LibSqlAdapterConfig,
  Statement,
  TransactionAdapter,
} from "./server/types";
