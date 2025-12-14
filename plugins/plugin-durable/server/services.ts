import type { DatabaseAdapter } from "@buntime/plugin-database";
import type { PluginContext } from "@buntime/shared/types";
import { DurableObjectRegistry } from "./registry";
import { initDatabase } from "./storage";

// Module-level state
let adapter: DatabaseAdapter;
let registry: DurableObjectRegistry;
let logger: PluginContext["logger"];

/**
 * Initialize durable objects service
 */
export async function initialize(
  db: DatabaseAdapter,
  config: {
    hibernateAfter: number;
    maxObjects: number;
  },
  pluginLogger: PluginContext["logger"],
): Promise<void> {
  adapter = db;
  logger = pluginLogger;

  await initDatabase(adapter);

  registry = new DurableObjectRegistry(adapter, {
    hibernateAfter: config.hibernateAfter,
    maxObjects: config.maxObjects,
  });
}

/**
 * Shutdown durable objects service
 */
export async function shutdown(): Promise<void> {
  await registry?.shutdown();
  // Don't close the adapter - it's managed by plugin-database
}

/**
 * Get the registry instance
 */
export function getRegistry(): DurableObjectRegistry {
  return registry;
}

/**
 * Get the logger instance
 */
export function getLogger(): PluginContext["logger"] {
  return logger;
}

// Export registry for API access
export { registry };
