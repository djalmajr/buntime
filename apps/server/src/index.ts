import type { WebSocketHandler } from "bun";
import { createApp } from "~/app";
import { APPS_DIR, PORT } from "~/constants";
import { pool } from "~/libs/pool/pool";
import { loadBuntimeConfig, PluginLoader } from "~/plugins/loader";
import { setRegistry } from "~/routes/internal/deployments";

// Load configuration and plugins
const config = await loadBuntimeConfig();
const loader = new PluginLoader(config, pool);
const registry = await loader.load();

// Create app with plugins
const app = createApp(registry);

// Set registry for deployment conflict detection
setRegistry(registry);

// Check existing apps for conflicts with plugin routes
async function checkExistingAppsForConflicts() {
  try {
    const entries = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: APPS_DIR, onlyFiles: false }));
    const mountedPaths = registry.getMountedPaths();

    for (const entry of entries) {
      // Only check top-level directories (apps)
      const stat = await Bun.file(`${APPS_DIR}/${entry}`).exists();
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

        console.warn(
          `[Warning] Existing app "${entry}" conflicts with plugin "${conflictingPlugin}" ` +
            `(mounted at "${pluginMountPath}"). Plugin routes take priority.`,
        );
      }
    }
  } catch {
    // Ignore errors (APPS_DIR might not exist yet)
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

console.log(`Server running at ${server.url}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Main] Shutting down...");
  await registry.shutdown();
  pool.shutdown();
  process.exit(0);
});

// Export for programmatic use
export { app, config, pool, registry };
export { type AppType, createApp } from "~/app";
export { loadBuntimeConfig, PluginLoader } from "~/plugins/loader";
export { PluginRegistry } from "~/plugins/registry";
