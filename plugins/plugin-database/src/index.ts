import type { BuntimePlugin, PluginContext, PluginLogger } from "@buntime/shared/types";
import { Hono } from "hono";
import { DatabaseServiceImpl } from "./service";
import type { DatabasePluginConfig, DatabaseService } from "./types";

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

const routes = new Hono()
  .onError((err, ctx) => {
    logger?.error("Database plugin error", { error: err.message });
    return ctx.json({ error: err.message }, 500);
  })
  // List tenants
  .get("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const tenants = await service.listTenants();
    return ctx.json({ tenants });
  })
  // Create tenant
  .post("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const body = await ctx.req.json<{ id?: string }>();
    if (!body.id || typeof body.id !== "string") {
      return ctx.json({ error: "Missing or invalid tenant id" }, 400);
    }

    await service.createTenant(body.id);
    return ctx.json({ ok: true, id: body.id }, 201);
  })
  // Delete tenant
  .delete("/tenants/:id", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const id = ctx.req.param("id");
    await service.deleteTenant(id);
    return ctx.json({ ok: true });
  })
  // Health check
  .get("/health", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized", status: "unhealthy" }, 500);
    }

    try {
      // Try a simple query to check connection
      const adapter = service.getRootAdapter();
      await adapter.execute("SELECT 1");
      return ctx.json({ status: "healthy" });
    } catch (error) {
      return ctx.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          status: "unhealthy",
        },
        500,
      );
    }
  });

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
    version: "1.0.0",

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

      // Register service for other plugins
      ctx.registerService<DatabaseService>("database", service);

      logger.info("Database plugin initialized");
    },

    async onShutdown() {
      await service?.close();
      service = null;
    },

    routes,
  };
}

// Named exports
export { databasePlugin };
export { BunSqlAdapter } from "./adapters/bun-sql";
export { LibSqlAdapter } from "./adapters/libsql";
export { DatabaseServiceImpl } from "./service";
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
} from "./types";
