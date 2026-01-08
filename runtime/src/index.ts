/**
 * Buntime Runner Server Entry Point
 *
 * This is the production entry point that starts the server.
 * Use this directly: `bun server/index.ts`
 *
 * For dev mode with frontend, use the root index.ts instead.
 */

import {
  app,
  buntimeConfig as config,
  hasPluginRoutes,
  logger,
  pluginRoutes,
  pool,
  registry,
  websocket,
} from "@/api";
import { NODE_ENV, PORT, SHUTDOWN_TIMEOUT_MS } from "@/constants";

const isDev = NODE_ENV === "development";

// Start server with appropriate options based on available features
const server = Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0, // Disable idle timeout - required for SSE/WebSocket
  port: PORT,
  ...(isDev && { development: { hmr: true } }),
  ...(hasPluginRoutes && { routes: pluginRoutes }),
  ...(websocket && { websocket }),
} as Parameters<typeof Bun.serve>[0]);

// Notify plugins that server has started
registry.runOnServerStart(server);

logger.info(`Runner started at ${server.url}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down...");

  // Force exit after timeout to prevent hung plugins from blocking shutdown
  const forceExitTimer = setTimeout(() => {
    logger.error("Shutdown timeout exceeded, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await registry.runOnShutdown();
    pool.shutdown();
    await logger.flush();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    logger.error("Error during shutdown", { error: err });
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
});

// Export for programmatic use
export { app, config, pool, registry };
