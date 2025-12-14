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
 * Process adapter config to substitute environment variables
 */
function processAdapterConfig(config: DatabasePluginConfig): DatabasePluginConfig {
  const adapter = { ...config.adapter };

  if ("url" in adapter) {
    adapter.url = substituteEnvVars(adapter.url);
  }

  if ("authToken" in adapter && adapter.authToken) {
    adapter.authToken = substituteEnvVars(adapter.authToken);
  }

  if ("adminUrl" in adapter && adapter.adminUrl) {
    adapter.adminUrl = substituteEnvVars(adapter.adminUrl);
  }

  if ("replicaUrl" in adapter && adapter.replicaUrl) {
    adapter.replicaUrl = substituteEnvVars(adapter.replicaUrl);
  }

  return { ...config, adapter };
}

/**
 * Database plugin for Buntime
 *
 * Provides a database abstraction layer with multi-tenancy support.
 * Other plugins can depend on this to get database access.
 *
 * @example
 * ```jsonc
 * // buntime.jsonc
 * {
 *   "plugins": [
 *     ["@buntime/plugin-database", {
 *       "adapter": {
 *         "type": "libsql",
 *         "url": "${LIBSQL_URL}",
 *         "authToken": "${LIBSQL_TOKEN}",
 *         "adminUrl": "${LIBSQL_ADMIN_URL}"
 *       },
 *       "tenancy": {
 *         "enabled": true,
 *         "header": "X-Tenant-ID",
 *         "defaultTenant": "default",
 *         "autoCreate": true
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
