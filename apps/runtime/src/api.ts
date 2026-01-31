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
import { Hono } from "hono";
import { generateSpecs, openAPIRouteHandler } from "hono-openapi";
import { createApp } from "@/app";
import { initConfig } from "@/config";
import { NODE_ENV, VERSION } from "@/constants";
import { WorkerPool } from "@/libs/pool/pool";
import { PluginLoader } from "@/plugins/loader";
import { createAppsRoutes } from "@/routes/apps";
import { createHealthRoutes } from "@/routes/health";
import { createPluginsRoutes } from "@/routes/plugins";
import { createWorkerRoutes } from "@/routes/worker";
import { createWorkerResolver } from "@/utils/get-worker-dir";

// Initialize logger first (before anything else)
// LOG_LEVEL from env with fallback based on NODE_ENV
const logLevel =
  (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ||
  (NODE_ENV === "production" ? "info" : "debug");

const logger = createLogger({
  format: NODE_ENV === "production" ? "json" : "pretty",
  level: logLevel,
});
// Set as global logger so shared modules can access it
setLogger(logger);

// Load configuration from environment variables
const runtimeConfig = initConfig();

// Set workerDirs as env var so plugin workers can access it
// Workers inherit Bun.env at spawn time
Bun.env.BUNTIME_WORKER_DIRS = JSON.stringify(runtimeConfig.workerDirs);

// Create pool with config
const pool = new WorkerPool({ maxSize: runtimeConfig.poolSize });

// Create worker resolver
const getWorkerDir = createWorkerResolver(runtimeConfig.workerDirs);

// Load plugins
const loader = new PluginLoader({ pool });
const registry = await loader.load();

// OpenAPI documentation config
const openApiDocumentation = {
  info: {
    description: "Buntime Runtime API for managing plugins and apps",
    title: "Buntime API",
    version: VERSION,
  },
  openapi: "3.1.0" as const,
  servers: [{ description: "Runtime API", url: "/api" }],
  tags: [
    { description: "Runtime health checks", name: "Health" },
    { description: "Plugin information and management", name: "Plugins" },
    { description: "App management (install, remove)", name: "Apps" },
  ],
};

/**
 * API routes mounted at /api/*
 */
const coreRoutes = new Hono()
  .route("/apps", createAppsRoutes())
  .route("/health", createHealthRoutes())
  .route("/plugins", createPluginsRoutes({ loader, registry }));

// Add OpenAPI spec and Scalar UI endpoints
// In dev mode, regenerate specs on each request to avoid caching issues
const openApiHandler =
  NODE_ENV === "production"
    ? openAPIRouteHandler(coreRoutes, { documentation: openApiDocumentation })
    : async (
        c: Parameters<typeof openAPIRouteHandler>[0] extends Hono<infer E>
          ? import("hono").Context<E>
          : never,
      ) => {
        const specs = await generateSpecs(coreRoutes, { documentation: openApiDocumentation });
        return c.json(specs);
      };

coreRoutes.get("/openapi.json", openApiHandler as any).get(
  "/docs",
  Scalar({
    metaData: { title: "Buntime API Docs" },
    theme: "purple",
    url: "/api/openapi.json",
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
  coreRoutes,
  getWorkerDir,
  homepage: runtimeConfig.homepage,
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
export { app, hasPluginRoutes, logger, pluginRoutes, pool, registry, runtimeConfig, websocket };
