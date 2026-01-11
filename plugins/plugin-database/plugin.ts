import type { PluginContext, PluginImpl, PluginLogger } from "@buntime/shared/types";
import type { Server } from "bun";
import manifest from "./manifest.jsonc";
import {
  api,
  handleWebSocketRequest,
  hranaWebSocketHandler,
  setServer,
  setService,
} from "./server/api";
import type { HranaWebSocketData } from "./server/hrana/websocket";
import { DatabaseServiceImpl } from "./server/service";
import type { AdapterConfig, DatabasePluginConfig, DatabaseService } from "./server/types";

let service: DatabaseServiceImpl | null = null;
let logger: PluginLogger;

function substituteEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

/**
 * Auto-detect libSQL URLs from environment variables.
 *
 * Convention: LIBSQL_URL_0, LIBSQL_URL_1, LIBSQL_URL_2, ...
 * - LIBSQL_URL_0 is always the primary (required)
 * - LIBSQL_URL_1, LIBSQL_URL_2, ... are replicas (optional)
 */
function detectLibSqlUrls(): string[] {
  const urls: string[] = [];
  let index = 0;

  while (true) {
    const envVar = process.env[`LIBSQL_URL_${index}`];
    if (!envVar) break;
    urls.push(envVar);
    index++;
  }

  return urls;
}

/**
 * Process a single adapter config with env var substitution
 */
function processAdapter(adapter: AdapterConfig, log: PluginLogger): AdapterConfig {
  const processed = { ...adapter, logger: log };

  // Substitute env vars in authToken
  if ("authToken" in processed && processed.authToken) {
    processed.authToken = substituteEnvVars(processed.authToken);
  }

  // Substitute env vars in url (for sqlite/postgres/mysql)
  if ("url" in processed && processed.url) {
    processed.url = substituteEnvVars(processed.url);
  }

  // Process urls array with env var substitution (for libsql)
  if ("urls" in processed && Array.isArray(processed.urls)) {
    processed.urls = processed.urls.map((url) => substituteEnvVars(url)).filter((url) => url);
  }

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
 * Process config to normalize adapters array and substitute env vars
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
 * @example Multiple adapters - each plugin has its own manifest.jsonc
 * ```jsonc
 * // plugins/plugin-database/manifest.jsonc
 * {
 *   "name": "@buntime/plugin-database",
 *   "enabled": true,
 *   "adapters": [
 *     { "type": "libsql", "default": true, "urls": ["http://localhost:8880"] },
 *     { "type": "sqlite", "url": "file:./auth.db" }
 *   ]
 * }
 * ```
 *
 * ```jsonc
 * // plugins/plugin-keyval/manifest.jsonc
 * { "name": "@buntime/plugin-keyval", "enabled": true, "database": "libsql" }
 * ```
 *
 * ```jsonc
 * // plugins/plugin-authn/manifest.jsonc
 * { "name": "@buntime/plugin-authn", "enabled": true, "database": "sqlite" }
 * ```
 */
export default function databasePlugin(config: DatabasePluginConfig = {}): PluginImpl {
  const base = manifest.base;

  return {
    // API routes run on main thread
    routes: api,

    // WebSocket handler for HRANA protocol
    websocket: hranaWebSocketHandler as PluginImpl["websocket"],

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

      // Register service for other plugins
      ctx.registerService<DatabaseService>("database", service);

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
