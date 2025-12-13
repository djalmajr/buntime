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
  const baseOptions = { fetch: app.fetch, port: PORT };

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
  await registry.shutdown();
  pool.shutdown();
  await logger.flush();
  process.exit(0);
});

// Export for programmatic use
export { app, config, pool, registry };
export { type AppType, createApp } from "@/app";
export { type LoadedBuntimeConfig, loadBuntimeConfig, PluginLoader } from "@/plugins/loader";
export { PluginRegistry } from "@/plugins/registry";

// Export route types for RPC clients
export type { InternalRoutesType } from "@/routes/internal";

// Default export for use in index.ts
export default app;
