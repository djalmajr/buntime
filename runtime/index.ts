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
const SHELL_BASE_PATH = "/cpanel";

// Build routes for Bun.serve
function buildRoutes() {
  // Base routes - always include plugin routes if available
  const baseRoutes = hasPluginRoutes ? { ...pluginRoutes } : {};

  // SPA routes for serving the shell (C-Panel)
  const spaRoutes = {
    [SHELL_BASE_PATH]: client,
    [`${SHELL_BASE_PATH}/*`]: client,
  };

  return { ...baseRoutes, ...spaRoutes };
}

// Start server with static frontend + API handler
async function startServer() {
  const routes = buildRoutes();

  const baseOptions = {
    fetch: app.fetch,
    port: PORT,
    routes,
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

const server = await startServer();

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
