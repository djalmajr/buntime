import type { BuntimePlugin, PluginContext, PluginLogger } from "@buntime/shared/types";
import { setService } from "./server/api";
import { DatabaseServiceImpl } from "./server/service";
import type { DatabasePluginConfig, DatabaseService } from "./server/types";

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
 * Process adapter config to substitute environment variables
 */
function processAdapterConfig(config: DatabasePluginConfig): DatabasePluginConfig {
  const adapter = { ...config.adapter };

  if ("authToken" in adapter && adapter.authToken) {
    adapter.authToken = substituteEnvVars(adapter.authToken);
  }

  // Process urls array with env var substitution
  if ("urls" in adapter && Array.isArray(adapter.urls)) {
    adapter.urls = adapter.urls.map((url) => substituteEnvVars(url)).filter((url) => url);
  }

  // Auto-detect libSQL URLs from environment and merge with config
  if ("type" in adapter && adapter.type === "libsql") {
    const envUrls = detectLibSqlUrls();
    const configUrls = (adapter as { urls?: string[] }).urls ?? [];

    // Merge: config urls first, then env urls (deduplicated via Set)
    const allUrls = [...new Set([...configUrls, ...envUrls])];

    if (allUrls.length > 0) {
      (adapter as { urls: string[] }).urls = allUrls;
    }
  }

  return { ...config, adapter };
}

/**
 * Database plugin for Buntime
 *
 * Provides a database abstraction layer with multi-tenancy support.
 * Other plugins can depend on this to get database access.
 *
 * URLs configuration for libSQL:
 * - urls[0] = Primary (writes + reads)
 * - urls[1..n] = Replicas (reads only, round-robin)
 *
 * Auto-detection from environment:
 * - LIBSQL_URL_0 = Primary
 * - LIBSQL_URL_1, LIBSQL_URL_2, ... = Replicas
 *
 * @example
 * ```jsonc
 * // buntime.jsonc
 * {
 *   "plugins": [
 *     ["@buntime/plugin-database", {
 *       "adapter": {
 *         "type": "libsql",
 *         "urls": ["http://primary:8080", "http://replica1:8080"],
 *         "authToken": "${LIBSQL_TOKEN}"
 *       }
 *     }]
 *   ]
 * }
 * ```
 */
export default function databasePlugin(config: DatabasePluginConfig): BuntimePlugin {
  return {
    name: "@buntime/plugin-database",
    base: config.base,

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      // Process config with env var substitution
      const processedConfig = processAdapterConfig(config);

      // Add logger to adapter config
      if (processedConfig.adapter) {
        (processedConfig.adapter as { logger?: PluginLogger }).logger = logger;
      }

      // Create service
      service = new DatabaseServiceImpl({
        config: processedConfig,
        logger,
      });

      // Set service for API routes
      setService(service, logger);

      // Register service for other plugins
      ctx.registerService<DatabaseService>("database", service);

      logger.info("Database plugin initialized");
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
