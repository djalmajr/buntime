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
import { NODE_ENV, PORT } from "@/config";

const isDev = NODE_ENV === "development";

// Start server with appropriate options based on available features
function startServer() {
  const baseOptions = {
    fetch: app.fetch,
    idleTimeout: 0, // Disable idle timeout - required for SSE/WebSocket (unidirectional, no incoming data)
    port: PORT,
  };

  // Build options based on what's available
  if (websocket && hasPluginRoutes) {
    return Bun.serve({
      ...baseOptions,
      routes: pluginRoutes,
      websocket,
      ...(isDev && { development: { hmr: true } }),
    });
  }

  if (websocket) {
    return Bun.serve({
      ...baseOptions,
      websocket,
      ...(isDev && { development: { hmr: true } }),
    });
  }

  if (hasPluginRoutes) {
    return Bun.serve({
      ...baseOptions,
      routes: pluginRoutes,
      ...(isDev && { development: { hmr: true } }),
    });
  }

  return Bun.serve({
    ...baseOptions,
    ...(isDev && { development: { hmr: true } }),
  });
}

const server = startServer();

// Notify plugins that server has started
registry.runOnServerStart(server);

logger.info(`Runner started at ${server.url}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down...");

  const SHUTDOWN_TIMEOUT = 30000; // 30 seconds

  // Force exit after timeout to prevent hung plugins from blocking shutdown
  const forceExitTimer = setTimeout(() => {
    console.error("[Buntime] Shutdown timeout exceeded, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    await registry.shutdown();
    pool.shutdown();
    await logger.flush();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    console.error("[Buntime] Error during shutdown:", err);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
});

// Export for programmatic use
export { app, config, pool, registry };
export { type AppType, createApp } from "@/app";
export { type LoadedBuntimeConfig, loadBuntimeConfig, PluginLoader } from "@/plugins/loader";
export { PluginRegistry } from "@/plugins/registry";

// Export route types for RPC clients
export type { PluginsInfoRoutesType } from "@/routes/plugins-info";

// Default export disabled - conflicts with Bun auto-serve when running directly
// export default app;
