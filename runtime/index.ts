/**
 * Buntime Runner Dev Entry Point
 *
 * This entry point combines the frontend (client) with the backend (server).
 * Use this for development: `bun --hot index.ts`
 *
 * For production without frontend, use server/index.ts directly.
 */

import { Hono } from "hono";
import { app, hasPluginRoutes, logger, pluginRoutes, pool, registry, websocket } from "@/api";
import { NODE_ENV, PORT } from "@/config";
import { createPiercingShellMiddleware, getShellHtml } from "@/utils/serve-shell-with-piercing";
import client from "~/index.html";

const isDev = NODE_ENV === "development";
const SHELL_BASE_PATH = "/cpanel";

// Check if we have fragments to pierce
const hasFragments = registry.hasFragments();

// Build routes based on whether piercing is needed
async function buildRoutes() {
  // Base routes - always include plugin routes if available
  const baseRoutes = hasPluginRoutes ? { ...pluginRoutes } : {};

  // SPA routes for serving the client
  // When fragments are enabled, shell HTML is handled by middleware but
  // static assets (CSS, JS) still need to be served via routes
  const spaRoutes = {
    [SHELL_BASE_PATH]: client,
    [`${SHELL_BASE_PATH}/*`]: client,
  };

  return { ...baseRoutes, ...spaRoutes };
}

// Create the fetch handler based on piercing support
async function createFetchHandler() {
  if (!hasFragments) {
    // No fragments - use app directly
    return app.fetch;
  }

  // With fragments - wrap app with piercing middleware
  const shellHtml = await getShellHtml("client/index.html");

  const piercingMiddleware = createPiercingShellMiddleware({
    basePath: SHELL_BASE_PATH,
    registry,
    shellHtml,
    generateMessageBusState: async (state) => ({
      ...state,
      // Add any global state here (theme, user info, etc.)
    }),
  });

  if (!piercingMiddleware) {
    // Fragments registered but no middleware created (shouldn't happen)
    logger.warn("Fragments registered but no piercing middleware created");
    return app.fetch;
  }

  // Create a wrapper Hono app with piercing middleware
  const wrapper = new Hono();

  // Serve piercing client script
  // Components are already registered in client/index.tsx, so this is a no-op
  wrapper.get("/_piercing/client.js", (ctx) => {
    return ctx.body(
      `// Piercing components already registered in main bundle
export function registerPiercingComponents() {}`,
      200,
      { "Content-Type": "application/javascript" },
    );
  });

  // Add piercing middleware for shell routes
  wrapper.use(`${SHELL_BASE_PATH}/*`, piercingMiddleware);
  wrapper.use(SHELL_BASE_PATH, piercingMiddleware);

  // Handle piercing-specific routes
  wrapper.use("/piercing-fragment/*", piercingMiddleware);
  wrapper.use("/_fragment/*", piercingMiddleware);

  // Fall back to main app for all other routes
  wrapper.all("*", async (ctx) => {
    return app.fetch(ctx.req.raw);
  });

  logger.info(
    `Piercing enabled for ${SHELL_BASE_PATH} with ${registry.collectFragments().length} fragments`,
  );

  return wrapper.fetch;
}

// Start server with static frontend + API handler
async function startServer() {
  const routes = await buildRoutes();
  const fetchHandler = await createFetchHandler();

  const baseOptions = {
    fetch: fetchHandler,
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
