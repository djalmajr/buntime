import type { DatabaseService } from "@buntime/plugin-database";
import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { initialize, shutdown } from "./server/services";

export interface DurableObjectsConfig extends BasePluginConfig {
  /**
   * Time in ms before idle objects hibernate
   * @default 60000
   */
  hibernateAfter?: number;

  /**
   * Maximum number of objects to keep in memory
   * @default 1000
   */
  maxObjects?: number;
}

/**
 * Durable Objects extension for Buntime
 *
 * Provides Cloudflare-like Durable Objects with:
 * - Singleton instances by ID
 * - Persistent storage via plugin-database
 * - Request serialization (single-threaded execution)
 * - Automatic hibernation and wake-up
 *
 * Requires @buntime/plugin-database to be configured.
 *
 * @example
 * ```jsonc
 * // buntime.jsonc
 * {
 *   "plugins": [
 *     ["@buntime/plugin-database", { "adapter": { "type": "libsql" } }],
 *     ["@buntime/plugin-durable", {
 *       "hibernateAfter": 60000,
 *       "maxObjects": 1000
 *     }]
 *   ]
 * }
 * ```
 */
export default function durableObjectsExtension(config: DurableObjectsConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-durable",
    base: config.base,
    dependencies: ["@buntime/plugin-database"],

    async onInit(ctx: PluginContext) {
      const databaseService = ctx.getService<DatabaseService>("database");
      if (!databaseService) {
        throw new Error(
          "@buntime/plugin-durable requires @buntime/plugin-database. " +
            "Add it to your plugins configuration.",
        );
      }

      const adapter = databaseService.getRootAdapter();

      await initialize(
        adapter,
        {
          hibernateAfter: config.hibernateAfter ?? 60_000,
          maxObjects: config.maxObjects ?? 1000,
        },
        ctx.logger,
      );

      ctx.logger.info("Durable Objects initialized (using plugin-database)");
    },

    async onShutdown() {
      await shutdown();
    },
  };
}

// Named exports
export { durableObjectsExtension };
export type { DurableRoutesType } from "./server/api";
export { DurableObjectRegistry } from "./server/registry";
export { DurableObjectStorage, initDatabase } from "./server/storage";
