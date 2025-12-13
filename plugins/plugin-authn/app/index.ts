import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import server from "./server";

// Path to dist/client directory (built by scripts/build.ts)
const pluginRoot = join(import.meta.dir, "..");
const clientDir = join(pluginRoot, "dist/client");

// Worker entrypoint - Bun.serve format
// Routes are relative (runner strips /auth prefix based on app routes)
export default {
  routes: {
    // API routes handled by Hono server
    "/api/*": server.fetch,
    "/api": server.fetch,
    "/session": server.fetch,
    "/logout": server.fetch,
  },

  // Static files handler for client SPA (serves from dist/client)
  fetch: createStaticHandler(clientDir),
};
