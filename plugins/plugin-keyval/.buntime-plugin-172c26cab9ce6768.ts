import type { AdapterType, DatabaseService } from "@buntime/plugin-database";
import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import { api } from "./server";
import { getKv, initialize, shutdown } from "./server/services";

export interface KeyValConfig {
  /**
   * Database adapter type to use (uses default if not specified)
   * @example "libsql", "sqlite", "postgres"
   */
  database?: AdapterType;

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
 * ```yaml
 * # plugins/plugin-database/manifest.yaml
 * name: "@buntime/plugin-database"
 * enabled: true
 * adapters:
 *   - type: libsql
 *     default: true
 *     urls:
 *       - http://localhost:8880
 * ```
 *
 * ```yaml
 * # plugins/plugin-keyval/manifest.yaml
 * name: "@buntime/plugin-keyval"
 * enabled: true
 * database: libsql
 * metrics:
 *   persistent: true
 * ```
 */
export default function keyvalExtension(config: KeyValConfig = {}): PluginImpl {
  return {
    // API routes run on main thread (required for SSE/watch endpoints)
    routes: api,

    // Expose kv service for other plugins (queue is accessible via kv.queue)
    provides: () => getKv(),

    async onInit(ctx: PluginContext) {
      // Get database service from plugin-database
      const database = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
      if (!database) {
        throw new Error("plugin-keyval requires @buntime/plugin-database to be loaded first");
      }

      await initialize(
        database,
        {
          adapterType: config.database,
          metrics: config.metrics,
          queue: config.queue,
        },
        ctx.logger,
      );

      const dbType = config.database ?? database.getDefaultType();
      ctx.logger.info(`KeyVal initialized (database: ${dbType})`);
    },

    async onShutdown() {
      await shutdown();
    },
  };
}

// Named exports
export { keyvalExtension };

export type { KeyvalRoutesType } from "./server";
export { AtomicOperation } from "./server/lib/atomic";
export { KvFts } from "./server/lib/fts";
export { Kv, type KvOptions } from "./server/lib/kv";
export { KvMetrics } from "./server/lib/metrics";
export { KvQueue, type KvQueueCleanupConfig } from "./server/lib/queue";
export { initSchema } from "./server/lib/schema";
export { KvTransaction } from "./server/lib/transaction";
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
} from "./server/lib/types";
export { createUuidv7, UUIDV7_SYMBOL } from "./server/lib/types";
