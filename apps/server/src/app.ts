import { errorToResponse } from "@buntime/shared/errors";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import type { PluginRegistry } from "@/plugins/registry";

/**
 * Get the default mount path for a plugin
 */
function getDefaultMountPath(pluginName: string): string {
  const shortName = pluginName.replace(/^@[^/]+\//, "");
  return `/_/${shortName}`;
}

export interface AppDeps {
  internal: Hono;
  registry?: PluginRegistry;
  workers: Hono;
}

/**
 * Create the main Hono app with plugin routes mounted
 */
export function createApp({ internal, registry, workers }: AppDeps) {
  const app = new HonoApp();

  // Run plugin onRequest hooks before routing (for proxy, auth, etc.)
  if (registry) {
    app.use("*", async (ctx, next) => {
      const result = await registry.runOnRequest(ctx.req.raw);

      // Plugin returned a response (short-circuit)
      if (result instanceof Response) {
        return result;
      }

      // Plugin may have modified the request - continue routing
      return next();
    });
  }

  // Mount internal routes
  app.route("/_", internal);

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
