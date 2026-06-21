/**
 * Buntime Runner Server Entry Point
 *
 * This is the production entry point that starts the server.
 * Use this directly: `bun server/index.ts`
 *
 * For dev mode with frontend, use the root index.ts instead.
 */

import { app, runtimeConfig as config, logger, pool, registry, websocket } from "@/api";
import { NODE_ENV, PORT, SHUTDOWN_TIMEOUT_MS } from "@/constants";
import { startCronScheduler } from "@/libs/cron/scheduler";

const isDev = NODE_ENV === "development";

// Process-level safety net. Plugin and background errors are wrapped at their
// source (registry hooks, pool cleanup timers, the cron scheduler), but as a last
// resort the runtime must never die silently and take every worker with it:
// - an unhandled promise rejection is logged and the runtime KEEPS serving (a
//   stray rejection from a plugin must not stop the workers);
// - an uncaught exception may leave state corrupted, so we log and exit so the
//   orchestrator (k8s) restarts the pod cleanly.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection (runtime surviving)", {
    reason: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  });
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception - exiting for a clean restart", {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  void Promise.resolve(logger.flush?.()).finally(() => process.exit(1));
});

/**
 * Build the Bun.serve native routes from the current registry state.
 *
 * Always includes the favicon short-circuit; merges every plugin's
 * `server.routes` (collected fresh from the registry). Called at boot AND on
 * every plugin rescan via `server.reload()` so uploaded/toggled plugins'
 * native routes go live without a restart.
 */
function buildServeRoutes(): Record<string, unknown> {
  return {
    "/favicon.ico": new Response(null, { status: 204 }),
    ...registry.collectServerRoutes(),
  };
}

// Start server with appropriate options based on available features
const server = Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0, // Disable idle timeout - required for SSE/WebSocket
  port: PORT,
  routes: buildServeRoutes(),
  ...(isDev && { development: { hmr: true } }),
  ...(websocket && { websocket }),
} as Parameters<typeof Bun.serve>[0]);

// Notify plugins that server has started
registry.runOnServerStart(server);

// Start the runtime cron scheduler: fires each worker's manifest `cron` jobs from
// this long-lived process (in-worker timers don't survive pooling). See
// `@/libs/cron/scheduler`.
const cronScheduler = await startCronScheduler({
  app,
  logger,
  rootKey: config.apiKey,
  workerDirs: config.workerDirs,
});

// Hot-reload: when a rescan changes the plugin set, refresh the live server's
// native routes (server.routes). Hono `routes` and `server.fetch` are already
// dispatched dynamically by `app.fetch`, so only Bun's native route table
// needs this explicit refresh.
registry.setReloadHandler(() => {
  server.reload({
    fetch: app.fetch,
    routes: buildServeRoutes(),
    ...(websocket && { websocket }),
  } as Parameters<typeof server.reload>[0]);
  logger.info("Server routes reloaded after plugin rescan");
});

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
    cronScheduler.stop();
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
