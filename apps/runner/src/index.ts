import { createLogger, setLogger } from "@buntime/shared/logger";
import type { WebSocketHandler } from "bun";
import { createApp } from "@/app";
import { getConfig, initConfig, NODE_ENV, PORT } from "@/config";
import { WorkerPool } from "@/libs/pool/pool";
import { loadBuntimeConfig, PluginLoader } from "@/plugins/loader";
import { createDeploymentRoutes } from "@/routes/internal/deployments";
import { createInternalRoutes } from "@/routes/internal/index";
import { createWorkerRoutes } from "@/routes/worker";
import { createAppResolver } from "@/utils/get-app-dir";

// Initialize logger first (before anything else)
const logger = createLogger({
  level: NODE_ENV === "production" ? "info" : "debug",
  format: NODE_ENV === "production" ? "json" : "pretty",
});
// Set as global logger so shared modules can access it
setLogger(logger);

// Load configuration
const buntimeConfig = await loadBuntimeConfig();
const runtimeConfig = initConfig(buntimeConfig);

// Create pool with config
const pool = new WorkerPool({ maxSize: runtimeConfig.poolSize });

// Create app resolver
const getAppDir = createAppResolver(runtimeConfig.appsDir);

// Load plugins
const loader = new PluginLoader(buntimeConfig, pool);
const registry = await loader.load();

// Create routes with dependencies
const deployments = createDeploymentRoutes({
  appsDir: runtimeConfig.appsDir,
  registry,
});

const internal = createInternalRoutes({
  deployments,
  pool,
  registry,
});

const workers = createWorkerRoutes({
  config: runtimeConfig,
  getAppDir,
  pool,
});

// Create app with routes and plugins
const app = createApp({ internal, registry, workers });

// Check existing apps for conflicts with plugin routes
async function checkExistingAppsForConflicts() {
  const { appsDir } = getConfig();

  try {
    const entries = await Array.fromAsync(
      new Bun.Glob("*").scan({ cwd: appsDir, onlyFiles: false }),
    );
    const mountedPaths = registry.getMountedPaths();

    for (const entry of entries) {
      // Only check top-level directories (apps)
      const stat = await Bun.file(`${appsDir}/${entry}`).exists();
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
    // Ignore errors (appsDir might not exist yet)
  }
}

await checkExistingAppsForConflicts();

// Get WebSocket handler from plugins (if any)
const websocket = registry.getWebSocketHandler() as WebSocketHandler<unknown> | undefined;

// Start server with or without WebSocket support
const server = websocket
  ? Bun.serve({ fetch: app.fetch, port: PORT, websocket })
  : Bun.serve({ fetch: app.fetch, port: PORT });

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
export { app, buntimeConfig as config, pool, registry };
export { type AppType, createApp } from "@/app";
export { loadBuntimeConfig, PluginLoader } from "@/plugins/loader";
export { PluginRegistry } from "@/plugins/registry";

// Export route types for RPC clients
export type { InternalRoutesType } from "@/routes/internal";
