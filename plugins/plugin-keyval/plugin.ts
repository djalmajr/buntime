import type { DatabaseService } from "@buntime/plugin-database";
import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { initialize, shutdown } from "./server/services";

export interface KeyValConfig extends BasePluginConfig {
  /**
   * Metrics settings
   */
  metrics?: {
    /**
     * Enable persistent metrics (stored in database)
     * @default false
     */
    persistent?: boolean;

    /**
     * Flush interval in ms for persisting metrics
     * @default 30000
     */
    flushInterval?: number;
  };

  /**
   * Queue cleanup settings
   */
  queue?: {
    /**
     * Cleanup interval in ms (0 to disable automatic cleanup)
     * @default 60000
     */
    cleanupInterval?: number;

    /**
     * Lock duration in ms for processing messages
     * Messages locked longer than this will be reset to pending
     * @default 30000
     */
    lockDuration?: number;
  };
}

/**
 * KeyVal extension for Buntime
 *
 * Provides a Deno KV-like key-value store with:
 * - Composite keys (array of parts)
 * - TTL support (expiresIn)
 * - Atomic transactions with optimistic concurrency control
 * - Prefix-based listing
 *
 * @example
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     "@buntime/plugin-database", // Required dependency
 *     ["@buntime/plugin-keyval", {
 *       metrics: { persistent: true },
 *     }],
 *   ],
 * }
 * ```
 */
export default function keyvalExtension(config: KeyValConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-keyval",
    base: config.base,
    dependencies: ["@buntime/plugin-database"],

    async onInit(ctx: PluginContext) {
      // Get database service from plugin-database
      const database = ctx.getService<DatabaseService>("database");
      if (!database) {
        throw new Error("plugin-keyval requires plugin-database to be loaded first");
      }

      const kv = await initialize(
        database,
        {
          metrics: config.metrics,
          queue: config.queue,
        },
        ctx.logger,
      );

      // Register kv service for other plugins (queue is accessible via kv.queue)
      ctx.registerService("kv", kv);

      ctx.logger.info("KeyVal initialized (using plugin-database adapter)");
    },

    async onShutdown() {
      await shutdown();
    },
  };
}

// Named exports
export { keyvalExtension };

export type { KeyvalRoutesType } from "./server/api";
export { AtomicOperation } from "./server/atomic";
export { KvFts } from "./server/fts";
export { Kv, type KvOptions } from "./server/kv";
export { KvMetrics } from "./server/metrics";
export { KvQueue, type KvQueueCleanupConfig } from "./server/queue";
export { initSchema } from "./server/schema";
export { KvTransaction } from "./server/transaction";
export type {
  KvCheck,
  KvCommitError,
  KvCommitResult,
  KvCreateIndexOptions,
  KvEnqueueOptions,
  KvEntry,
  KvFtsTokenizer,
  KvIndex,
  KvKey,
  KvKeyPart,
  KvKeyPartWithUuidv7,
  KvKeyWithUuidv7,
  KvListOptions,
  KvMutation,
  KvMutationType,
  KvPaginateOptions,
  KvPaginateResult,
  KvQueueEntry,
  KvQueueMessage,
  KvSearchOptions,
  KvSetOptions,
  KvTransactionError,
  KvTransactionOptions,
  KvTransactionResult,
  KvUuidv7,
} from "./server/types";
export { createUuidv7, UUIDV7_SYMBOL } from "./server/types";
