import type { PluginContext } from "@buntime/shared/types";
import type { Client } from "@libsql/client/http";
import { DurableObjectRegistry } from "./registry";
import { initDatabase } from "./storage";

// Module-level state
let client: Client;
let registry: DurableObjectRegistry;
let logger: PluginContext["logger"];

/**
 * Initialize durable objects service
 */
export async function initialize(
  db: Client,
  config: {
    hibernateAfter: number;
    maxObjects: number;
  },
  pluginLogger: PluginContext["logger"],
): Promise<void> {
  client = db;
  logger = pluginLogger;

  await initDatabase(client);

  registry = new DurableObjectRegistry(client, {
    hibernateAfter: config.hibernateAfter,
    maxObjects: config.maxObjects,
  });
}

/**
 * Shutdown durable objects service
 */
export async function shutdown(): Promise<void> {
  await registry?.shutdown();
  client?.close();
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
