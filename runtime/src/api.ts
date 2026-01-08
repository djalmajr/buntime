/**
 * Buntime Runner API
 *
 * This module initializes all dependencies and creates the main Hono app.
 * It exports the app and dependencies without starting the server.
 *
 * The server is started by src/index.ts which imports from here.
 */

import { createLogger, setLogger } from "@buntime/shared/logger";
import type { WebSocketHandler } from "bun";
import { createApp } from "@/app";
import { initConfig } from "@/config";
import { NODE_ENV } from "@/constants";
import { WorkerPool } from "@/libs/pool/pool";
import { loadBuntimeConfig, PluginLoader } from "@/plugins/loader";
import { createPluginsInfoRoutes } from "@/routes/plugins-info";
import { createWorkerRoutes } from "@/routes/worker";
import { createAppResolver } from "@/utils/get-app-dir";

// Initialize logger first (before anything else)
const logger = createLogger({
  format: NODE_ENV === "production" ? "json" : "pretty",
  level: NODE_ENV === "production" ? "info" : "debug",
});
// Set as global logger so shared modules can access it
setLogger(logger);

// Load configuration
const { baseDir, config: buntimeConfig } = await loadBuntimeConfig();
const runtimeConfig = initConfig(buntimeConfig, baseDir);

// Set workspaces as env var so plugin workers can access it
// Workers inherit Bun.env at spawn time
Bun.env.BUNTIME_WORKSPACES = JSON.stringify(runtimeConfig.workspaces);

// Create pool with config
const pool = new WorkerPool({ maxSize: runtimeConfig.poolSize });

// Create app resolver
const getAppDir = createAppResolver(runtimeConfig.workspaces);

// Load plugins
const loader = new PluginLoader(buntimeConfig, pool);
const registry = await loader.load();

// Create routes with dependencies
const pluginsInfo = createPluginsInfoRoutes({ registry });

const workers = createWorkerRoutes({
  config: runtimeConfig,
  getAppDir,
  pool,
  registry,
});

// Create app with routes and plugins
const app = createApp({
  getAppDir,
  homepage: runtimeConfig.homepage,
  pluginsInfo,
  pool,
  registry,
  workers,
});

// Get WebSocket handler from plugins (if any)
const websocket = registry.getWebSocketHandler() as WebSocketHandler<unknown> | undefined;

// Collect plugin server.routes (wrapped with auth)
const pluginRoutes = registry.collectServerRoutes();
const hasPluginRoutes = Object.keys(pluginRoutes).length > 0;

// Export everything needed to start the server
export { app, buntimeConfig, hasPluginRoutes, logger, pluginRoutes, pool, registry, websocket };
