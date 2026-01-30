import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { createGatewayApi } from "./server/api";
import type { GatewayConfig } from "./server/types";

// Worker entrypoint - Bun.serve format
// This serves both the API and the client UI

const config: GatewayConfig = {};

const api = createGatewayApi(
  () => config,
  () => null, // rateLimiter not available in worker context
  () => null, // responseCache not available in worker context
);

// Path to client directory (relative to dist/index.js, built by scripts/build.ts)
const clientDir = join(import.meta.dir, "client");

export default {
  routes: {
    "/api/*": api.fetch,
  },
  fetch: createStaticHandler(clientDir),
};
