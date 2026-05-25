/**
 * Buntime Runner API
 *
 * This module initializes all dependencies and creates the main Hono app.
 * It exports the app and dependencies without starting the server.
 *
 * The server is started by src/index.ts which imports from here.
 */

import { createLogger, setLogger } from "@buntime/shared/logger";
import { Scalar } from "@scalar/hono-api-reference";
import type { WebSocketHandler } from "bun";
import { type Handler, Hono } from "hono";
import { generateSpecs, openAPIRouteHandler } from "hono-openapi";
import { createApp } from "@/app";
import { initConfig } from "@/config";
import { API_PATH, NODE_ENV, VERSION } from "@/constants";
import { ApiKeyStore } from "@/libs/api-keys";
import { pluginsPathPolicy, workersPathPolicy } from "@/libs/fs/path-policies";
import { WorkerPool } from "@/libs/pool/pool";
import { PluginLoader } from "@/plugins/loader";
import { createAdminRoutes } from "@/routes/admin";
import { createFsRoutes } from "@/routes/fs";
import { createHealthRoutes } from "@/routes/health";
import { createKeysRoutes } from "@/routes/keys";
import { createPluginsRoutes } from "@/routes/plugins";
import { createWorkerRoutes } from "@/routes/worker";
import { createWorkersRoutes } from "@/routes/workers";
import { createWorkerResolver } from "@/utils/get-worker-dir";

// Initialize logger first (before anything else)
// RUNTIME_LOG_LEVEL from env with fallback based on NODE_ENV
const logLevel =
  (Bun.env.RUNTIME_LOG_LEVEL as "debug" | "info" | "warn" | "error") ||
  (NODE_ENV === "production" ? "info" : "debug");

const logger = createLogger({
  format: NODE_ENV === "production" ? "json" : "pretty",
  level: logLevel,
});
// Set as global logger so shared modules can access it
setLogger(logger);

// Load configuration from environment variables
const runtimeConfig = initConfig();

// Create pool with config
const pool = new WorkerPool({ maxSize: runtimeConfig.poolSize });

// Turso DB-backed API key store. Mode "local" is the default (self-contained,
// single-pod); "sync" syncs an embedded replica with a Turso server primary
// (multi-pod). Bootstrap independence: opens without any plugin loaded.
const apiKeys = await ApiKeyStore.fromStateDir(runtimeConfig.stateDir, runtimeConfig.authDb);

// Create worker resolver
const getWorkerDir = createWorkerResolver(runtimeConfig.workerDirs);

// Load plugins. Forward the API key store + master key so plugins can protect
// their /<base>/admin/** routes with the shared createApiKeyMiddleware.
const loader = new PluginLoader({ apiKeys, rootKey: runtimeConfig.apiKey, pool });
const registry = await loader.load();

// OpenAPI documentation config
const openApiDocumentation = {
  info: {
    description: "Buntime Runtime API for managing plugins and workers",
    title: "Buntime API",
    version: VERSION,
  },
  openapi: "3.1.0" as const,
  servers: [{ description: "Runtime API", url: API_PATH }],
  tags: [
    { description: "Runtime admin session and capabilities", name: "Admin" },
    { description: "Runtime health checks", name: "Health" },
    { description: "Plugin information and management", name: "Plugins" },
    { description: "Worker management (install, remove)", name: "Workers" },
    { description: "Runtime API key management", name: "API Keys" },
  ],
};

/**
 * API routes mounted at /api/*
 */
const coreRoutes = new Hono()
  .route("/admin", createAdminRoutes({ rootKey: runtimeConfig.apiKey, store: apiKeys }))
  .route("/health", createHealthRoutes())
  .route("/keys", createKeysRoutes({ store: apiKeys }))
  .route("/plugins", createPluginsRoutes({ loader, registry }))
  // File-browser surface for plugins (replaces plugin-deployments for plugin dirs).
  // Free-form: any path inside a plugin folder is writable.
  .route(
    "/plugins/files",
    createFsRoutes({ pathPolicy: pluginsPathPolicy, resolveDirs: () => runtimeConfig.pluginDirs }),
  )
  .route("/workers", createWorkersRoutes())
  // File-browser surface for workers (replaces plugin-deployments for worker dirs).
  // Semver-aware: uploads must target a version folder (`{name}/{version}/...`).
  .route(
    "/workers/files",
    createFsRoutes({ pathPolicy: workersPathPolicy, resolveDirs: () => runtimeConfig.workerDirs }),
  );

// Add OpenAPI spec and Scalar UI endpoints
// In dev mode, regenerate specs on each request to avoid caching issues
const openApiHandler: Handler =
  NODE_ENV === "production"
    ? openAPIRouteHandler(coreRoutes, { documentation: openApiDocumentation })
    : async (c) => {
        const specs = await generateSpecs(coreRoutes, { documentation: openApiDocumentation });
        return c.json(specs);
      };

coreRoutes.get("/openapi.json", openApiHandler).get(
  "/docs",
  Scalar({
    metaData: { title: "Buntime API Docs" },
    theme: "purple",
    url: `${API_PATH}/openapi.json`,
  }),
);

const workers = createWorkerRoutes({
  config: runtimeConfig,
  getWorkerDir,
  pool,
  registry,
});

// Create app with routes and plugins
const app = createApp({
  apiKeys,
  coreRoutes,
  getWorkerDir,
  pool,
  registry,
  workers,
});

// Get WebSocket handler from plugins (if any)
const websocket = registry.getWebSocketHandler() as WebSocketHandler<unknown> | undefined;

// Collect plugin server.routes (wrapped with auth)
const pluginRoutes = registry.collectServerRoutes();
const hasPluginRoutes = Object.keys(pluginRoutes).length > 0;

// Export everything needed to start the server
export {
  apiKeys,
  app,
  hasPluginRoutes,
  logger,
  pluginRoutes,
  pool,
  registry,
  runtimeConfig,
  websocket,
};
