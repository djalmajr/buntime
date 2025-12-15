/**
 * Buntime Runner API
 *
 * This module initializes all dependencies and creates the main Hono app.
 * It exports the app and dependencies without starting the server.
 *
 * Use this for:
 * - Production server (server/index.ts imports and runs Bun.serve)
 * - Dev mode with frontend (root index.ts imports and combines with client)
 */

import { createLogger, setLogger } from "@buntime/shared/logger";
import type { WebSocketHandler } from "bun";
import { createApp } from "@/app";
import { getConfig, initConfig, NODE_ENV } from "@/config";
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
  pluginsInfo,
  pool,
  registry,
  workers,
});

// Check existing apps for conflicts with plugin routes
async function checkExistingAppsForConflicts() {
  const { workspaces } = getConfig();
  const mountedPaths = registry.getMountedPaths();

  for (const workspace of workspaces) {
    try {
      const entries = await Array.fromAsync(
        new Bun.Glob("*").scan({ cwd: workspace, onlyFiles: false }),
      );

      for (const entry of entries) {
        // Only check top-level directories (apps)
        const stat = await Bun.file(`${workspace}/${entry}`).exists();
        if (stat) continue; // Skip files

        const appPath = `/${entry}`;
        const conflictingPlugin = registry.checkRouteConflict(appPath);
        if (conflictingPlugin) {
          // Find the actual mount path of the conflicting plugin
          let pluginMountPath = "";
          for (const [path, name] of mountedPaths) {
            if (name === conflictingPlugin) {
              pluginMountPath = path;
              break;
            }
          }

          logger.warn(
            `Existing app "${entry}" conflicts with plugin "${conflictingPlugin}" (mounted at "${pluginMountPath}"). Plugin routes take priority.`,
          );
        }
      }
    } catch {
      // Ignore errors (workspace might not exist yet)
    }
  }
}

await checkExistingAppsForConflicts();

// Get WebSocket handler from plugins (if any)
const websocket = registry.getWebSocketHandler() as WebSocketHandler<unknown> | undefined;

// Collect plugin server.routes (wrapped with auth)
const pluginRoutes = registry.collectServerRoutes();
const hasPluginRoutes = Object.keys(pluginRoutes).length > 0;

// Export everything needed to start the server
export {
  app,
  buntimeConfig,
  hasPluginRoutes,
  logger,
  pluginRoutes,
  pool,
  registry,
  runtimeConfig,
  websocket,
};

// Re-export types
export { type AppType, createApp } from "@/app";
export { type LoadedBuntimeConfig, loadBuntimeConfig, PluginLoader } from "@/plugins/loader";
export { PluginRegistry } from "@/plugins/registry";
export type { PluginsInfoRoutesType } from "@/routes/plugins-info";
