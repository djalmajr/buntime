import { createGatewayApi } from "./server/api";
import type { GatewayConfig } from "./server/types";

// Worker entrypoint - Bun.serve format (API-only)
// This is a minimal API-only worker, config is managed by the plugin

const config: GatewayConfig = {};

const api = createGatewayApi(
  () => config,
  () => null, // rateLimiter not available in worker context
  () => null, // responseCache not available in worker context
);

export default {
  fetch: api.fetch,
};
