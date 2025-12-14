import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { createClient } from "@libsql/client/http";
import { initialize, shutdown } from "./server/services";

export interface DurableObjectsConfig extends BasePluginConfig {
  /**
   * Time in ms before idle objects hibernate
   * @default 60000
   */
  hibernateAfter?: number;

  /**
   * libSQL auth token (for remote databases)
   * Supports ${ENV_VAR} syntax
   */
  libsqlToken?: string;

  /**
   * libSQL database URL
   * Supports ${ENV_VAR} syntax
   * @default "file:./durable-objects.db"
   */
  libsqlUrl?: string;

  /**
   * Maximum number of objects to keep in memory
   * @default 1000
   */
  maxObjects?: number;
}

function substituteEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

/**
 * Durable Objects extension for Buntime
 *
 * Provides Cloudflare-like Durable Objects with:
 * - Singleton instances by ID
 * - Persistent storage via libSQL
 * - Request serialization (single-threaded execution)
 * - Automatic hibernation and wake-up
 *
 * @example
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     ["@buntime/durable", {
 *       libsqlUrl: "${LIBSQL_URL}",
 *       libsqlToken: "${LIBSQL_TOKEN}",
 *     }],
 *   ],
 * }
 * ```
 */
export default function durableObjectsExtension(config: DurableObjectsConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-durable",
    base: config.base,

    async onInit(ctx: PluginContext) {
      const url = config.libsqlUrl
        ? substituteEnvVars(config.libsqlUrl)
        : "file:./durable-objects.db";

      const authToken = config.libsqlToken ? substituteEnvVars(config.libsqlToken) : undefined;

      const client = createClient({ url, authToken });

      await initialize(
        client,
        {
          hibernateAfter: config.hibernateAfter ?? 60_000,
          maxObjects: config.maxObjects ?? 1000,
        },
        ctx.logger,
      );

      ctx.logger.info(`Durable Objects initialized (storage: ${url})`);
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
