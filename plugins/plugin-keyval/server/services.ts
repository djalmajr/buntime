import type { DatabaseAdapter, DatabaseService } from "@buntime/plugin-database";
import type { PluginContext } from "@buntime/shared/types";
import { setApiState } from "./api";
import { Kv } from "./kv";
import { initSchema } from "./schema";

// Module-level state
let kv: Kv;
let adapter: DatabaseAdapter;
let logger: PluginContext["logger"];

interface KvServiceConfig {
  metrics?: {
    persistent?: boolean;
    flushInterval?: number;
  };
  queue?: {
    cleanupInterval?: number;
    lockDuration?: number;
  };
}

/**
 * Initialize KeyVal service
 */
export async function initialize(
  database: DatabaseService,
  config: KvServiceConfig,
  pluginLogger: PluginContext["logger"],
): Promise<Kv> {
  logger = pluginLogger;

  // Get root adapter (or tenant-specific adapter via middleware if needed)
  adapter = database.getRootAdapter();

  // Initialize schema
  await initSchema(adapter);

  // Create Kv instance
  kv = new Kv(adapter, {
    logger,
    persistentMetrics: config.metrics?.persistent,
    metricsFlushInterval: config.metrics?.flushInterval,
    queueCleanup: config.queue,
  });

  // Set API state
  setApiState(kv, adapter, logger);

  return kv;
}

/**
 * Shutdown KeyVal service
 */
export async function shutdown(): Promise<void> {
  await kv?.close();
}

/**
 * Get the Kv instance
 */
export function getKv(): Kv {
  return kv;
}

/**
 * Get the logger instance
 */
export function getLogger(): PluginContext["logger"] {
  return logger;
}

// Export kv for direct access
export { kv };
