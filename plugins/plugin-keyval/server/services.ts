import type { TursoService } from "@buntime/plugin-turso";
import type { PluginContext } from "@buntime/shared/types";
import { setApiState } from "./index";
import { Kv } from "./lib/kv";
import { initSchema } from "./lib/schema";
import { type KeyValSqlAdapter, TursoKeyValAdapter } from "./lib/sql-adapter.ts";

// Module-level state
let kv: Kv;
let adapter: KeyValSqlAdapter;
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
  turso: TursoService,
  config: KvServiceConfig,
  pluginLogger: PluginContext["logger"],
): Promise<Kv> {
  logger = pluginLogger;

  adapter = new TursoKeyValAdapter({
    namespace: "keyval",
    service: turso,
  });

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
