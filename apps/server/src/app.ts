import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import type { PluginRegistry } from "~/plugins/registry";
import internal from "~/routes/internal/index";
import workers from "~/routes/worker";

/**
 * Get the default mount path for a plugin
 */
function getDefaultMountPath(pluginName: string): string {
  const shortName = pluginName.replace(/^@[^/]+\//, "");
  return `/_/${shortName}`;
}

/**
 * Create the main Hono app with plugin routes mounted
 */
export function createApp(registry?: PluginRegistry) {
  const app = new Hono().route("/_", internal);

  // Track mounted plugin paths for conflict detection
  const pluginPaths = new Map<string, string>();

  // Mount plugin routes
  if (registry) {
    for (const plugin of registry.getAll()) {
      if (plugin.routes) {
        const mountPath = plugin.mountPath || getDefaultMountPath(plugin.name);
        pluginPaths.set(mountPath, plugin.name);
        app.route(mountPath, plugin.routes);
        console.log(`[Plugin] ${plugin.name} routes mounted at ${mountPath}`);
      }
    }

    // Store plugin paths in registry for conflict detection with workers
    registry.setMountedPaths(pluginPaths);
  }

  // Mount worker routes
  app.route("/", workers);

  // Error handler
  app.onError(errorToResponse);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
