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
import { PluginLoader } from "@/plugins/loader";
import { createAppsCoreRoutes } from "@/routes/apps-core";
import { createConfigCoreRoutes } from "@/routes/config-core";
import { createPluginsCoreRoutes } from "@/routes/plugins-core";
import { createPluginsInfoRoutes } from "@/routes/plugins-info";
import { createWorkerRoutes } from "@/routes/worker";
import { createWorkerResolver } from "@/utils/get-worker-dir";

// Initialize logger first (before anything else)
const logger = createLogger({
  format: NODE_ENV === "production" ? "json" : "pretty",
  level: NODE_ENV === "production" ? "info" : "debug",
});
// Set as global logger so shared modules can access it
setLogger(logger);

// Load configuration from environment variables
const runtimeConfig = initConfig();

// Set workerDirs as env var so plugin workers can access it
// Workers inherit Bun.env at spawn time
Bun.env.BUNTIME_WORKER_DIRS = JSON.stringify(runtimeConfig.workerDirs);

// Create pool with config
const pool = new WorkerPool({ maxSize: runtimeConfig.poolSize });

// Create worker resolver
const getWorkerDir = createWorkerResolver(runtimeConfig.workerDirs);

// Load plugins
const loader = new PluginLoader({ pool });
const registry = await loader.load();

// Create routes with dependencies
const pluginsInfo = createPluginsInfoRoutes({ registry });
const pluginsCore = createPluginsCoreRoutes({ loader });
const configCore = createConfigCoreRoutes({ loader });
const appsCore = createAppsCoreRoutes();

const workers = createWorkerRoutes({
  config: runtimeConfig,
  getWorkerDir,
  pool,
  registry,
});

// Create app with routes and plugins
const app = createApp({
  appsCore,
  configCore,
  getWorkerDir,
  homepage: runtimeConfig.homepage,
  pluginsCore,
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
export { app, hasPluginRoutes, logger, pluginRoutes, pool, registry, runtimeConfig, websocket };
