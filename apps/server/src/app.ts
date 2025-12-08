import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import type { PluginRegistry } from "~/plugins/registry";
import internal from "~/routes/internal/index";
import workers from "~/routes/worker";

/**
 * Create the main Hono app with plugin routes mounted
 */
export function createApp(registry?: PluginRegistry) {
  const app = new Hono().route("/_", internal);

  // Mount plugin routes (/_/{plugin-short-name}/*)
  if (registry) {
    for (const plugin of registry.getAll()) {
      if (plugin.routes) {
        // Extract short name from "@buntime/metrics" -> "metrics"
        const shortName = plugin.name.replace(/^@[^/]+\//, "");
        app.route(`/_/${shortName}`, plugin.routes);
      }
    }
  }

  // Mount worker routes
  app.route("/", workers);

  // Error handler
  app.onError(errorToResponse);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
