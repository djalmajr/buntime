/**
 * Buntime Runner Dev Entry Point
 *
 * This entry point combines the frontend (client) with the backend (server).
 * Use this for development: `bun --hot index.ts`
 *
 * For production without frontend, use server/index.ts directly.
 */

import { app, hasPluginRoutes, logger, pluginRoutes, pool, registry, websocket } from "@/api";
import { NODE_ENV, PORT } from "@/config";
import client from "~/index.html";

const isDev = NODE_ENV === "development";

// SPA routes - client handles all sub-routes
const spaRoutes = {
  "/cpanel": client,
  "/cpanel/*": client,
};

// Merge SPA routes with plugin routes
const allRoutes = hasPluginRoutes ? { ...spaRoutes, ...pluginRoutes } : spaRoutes;

// Start server with static frontend + API handler
function startServer() {
  const baseOptions = {
    fetch: app.fetch,
    port: PORT,
    routes: allRoutes,
  };

  if (websocket) {
    return Bun.serve({
      ...baseOptions,
      websocket,
      ...(isDev && { development: { console: true, hmr: true } }),
    });
  }

  return Bun.serve({
    ...baseOptions,
    ...(isDev && { development: { console: true, hmr: true } }),
  });
}

const server = startServer();

// Notify plugins that server has started
registry.runOnServerStart(server);

logger.info(`Runner (with frontend) started at ${server.url}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  await registry.shutdown();
  pool.shutdown();
  await logger.flush();
  process.exit(0);
});
