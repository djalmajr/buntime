import type { BuntimePlugin, PluginContext, PluginLogger } from "@buntime/shared/types";
import { api, setService } from "./server/api";
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
 * @example Multiple adapters
 * ```jsonc
 * {
 *   "plugins": [
 *     ["@buntime/plugin-database", {
 *       "adapters": [
 *         { "type": "libsql", "default": true, "urls": ["http://localhost:8880"] },
 *         { "type": "sqlite", "url": "file:./auth.db" }
 *       ]
 *     }],
 *     ["@buntime/plugin-keyval", { "database": "libsql" }],
 *     ["@buntime/plugin-authn", { "database": "sqlite" }]
 *   ]
 * }
 * ```
 */
export default function databasePlugin(config: DatabasePluginConfig): BuntimePlugin {
  return {
    name: "@buntime/plugin-database",
    base: config.base ?? "/database",

    // API routes run on main thread
    routes: api,

    // Fragment with patch sandbox (internal plugin)
    fragment: {
      type: "patch",
    },

    // Menu items for C-Panel sidebar
    menus: [
      {
        icon: "lucide:database",
        path: "/database",
        priority: 70,
        title: "Database",
        items: [
          { icon: "lucide:home", path: "/database", title: "Overview" },
          { icon: "lucide:table-2", path: "/database/studio", title: "Studio" },
        ],
      },
    ],

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      // Process config with env var substitution
      const processedConfig = processConfig(config, logger);

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
