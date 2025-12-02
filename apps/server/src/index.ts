import type { WebSocketHandler } from "bun";
import { createApp } from "~/app";
import { PORT } from "~/constants";
import { pool } from "~/libs/pool/pool";
import { loadBuntimeConfig, PluginLoader } from "~/plugins/loader";

// Load configuration and plugins
const config = await loadBuntimeConfig();
const loader = new PluginLoader(config, pool);
const registry = await loader.load();

// Create app with plugins
const app = createApp(registry);

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
