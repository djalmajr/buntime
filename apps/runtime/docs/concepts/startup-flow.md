# Startup Flow

This document describes the complete Buntime startup flow in different
environments (development and production).

## Overview

Buntime follows a layered initialization flow:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           INITIALIZATION                                  │
├───────────────────────────────────────────────────────────────────────────┤
│  1. constants.ts    -> Validates environment variables (PORT, NODE_ENV)   │
│  2. config.ts       -> Loads configuration (workerDirs, pluginDirs)       │
│  3. loader.ts       -> Discovers and loads plugins (filesystem)           │
│  4. api.ts          -> Creates Hono app with routes                       │
│  5. index.ts        -> Starts Bun.serve                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

## Environment Differences

| Aspect | Development | Production |
|--------|-------------|------------|
| Pool Size | 10 workers | 500 workers |
| Logger Format | `pretty` (colored) | `json` (structured) |
| Log Level | `debug` | `info` |
| Hot Reload | Enabled (HMR) | Disabled |
| Initialization | Slower (node_modules) | Fast (embedded plugins) |

## Detailed Flow

### Step 1: Environment Variables (constants.ts)

The first imported module validates required environment variables using Zod:

``` typescript
// apps/runtime/src/constants.ts
export const { DELAY_MS, NODE_ENV, PORT } = envSchema.parse(Bun.env);
export const IS_DEV = NODE_ENV === "development";
export const IS_COMPILED = typeof BUNTIME_COMPILED !== "undefined";
```

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Execution environment (development, production, staging, test) |
| `PORT` | 8000 | HTTP server port |
| `DELAY_MS` | 100 | Delay before terminating worker (graceful shutdown) |

### Step 2: Configuration (config.ts)

The configuration module expands environment variables and resolves paths:

``` typescript
// apps/runtime/src/config.ts
export function initConfig(options?: InitConfigOptions): RuntimeConfig {
  // 1. Expand workerDirs (RUNTIME_WORKER_DIRS env var)
  const workerDirs = expandDirs(workerDirConfig, baseDir);

  // 2. Expand pluginDirs (RUNTIME_PLUGIN_DIRS or default "./plugins")
  const pluginDirs = expandDirs(pluginDirConfig, baseDir);

  // 3. Define poolSize by environment (RUNTIME_POOL_SIZE or default)
  const poolSize = parsePoolSize(Bun.env.RUNTIME_POOL_SIZE, envFallback);

  return { workerDirs, pluginDirs, poolSize, ... };
}
```

#### Pool Size by Environment

| Environment | Default Pool Size |
|-------------|-------------------|
| development | 10 |
| staging | 50 |
| production | 500 |
| test | 5 |

### Step 3: Plugin Loading (loader.ts)

Plugins are loaded directly from the filesystem. The enabled/disabled state
is controlled by the `enabled` field in each plugin's `manifest.yaml`.

```
┌─────────────────┐
│  Plugin Loader  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐    ┌────────────────────┐
│  Scan Dirs      │───>│ RUNTIME_PLUGIN_DIRS│
│  (filesystem)   │    │ ./plugins          │
└────────┬────────┘    └────────────────────┘
         │
         ▼
┌─────────────────┐
│  Load Manifest  │    manifest.yaml
│  (each plugin)  │    name: "...", base: "/api"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Check Enabled  │
│  (manifest)     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
 enabled?  disabled
    │         │
    ▼         ▼
 LOAD      SKIP
```

``` typescript
// apps/runtime/src/plugins/loader.ts
for (const dir of pluginDirs) {
  // 1. Check for manifest.yaml
  const manifest = await loadManifest(pluginDir);

  // 2. Check if enabled in manifest
  if (manifest.enabled === false) {
    logger.debug(`Skipping disabled plugin: ${manifest.name}`);
    continue;
  }

  // 3. Load implementation
  const plugin = await loadImplementation(pluginDir, manifest);
  registry.register(plugin);
}
```

> [!NOTE]
> The `enabled` field in `manifest.yaml` controls whether the plugin is loaded.
> By default, plugins are enabled (`enabled: true`).

### Step 4: Hono App (api.ts)

After loading plugins, the Hono app is mounted:

``` typescript
// apps/runtime/src/api.ts

// 1. Global logger (format depends on environment)
const logLevel = Bun.env.RUNTIME_LOG_LEVEL ||
  (NODE_ENV === "production" ? "info" : "debug");

const logger = createLogger({
  format: NODE_ENV === "production" ? "json" : "pretty",
  level: logLevel,
});

// 2. Initialize config
const runtimeConfig = initConfig();

// 3. Create worker pool
const pool = new WorkerPool({ maxSize: runtimeConfig.poolSize });

// 4. Load plugins
const loader = new PluginLoader({ pool });
const registry = await loader.load();

// 5. Create core routes
const coreRoutes = new Hono()
  .route("/apps", createAppsRoutes())
  .route("/health", createHealthRoutes())
  .route("/plugins", createPluginsRoutes({ loader, registry }));

// 6. Mount app
const app = createApp({
  coreRoutes,
  getWorkerDir,
  pool,
  registry,
  workers,
});
```

### Step 5: HTTP Server (index.ts)

Finally, the Bun server is started:

``` typescript
// apps/runtime/src/index.ts
const server = Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,  // Disable idle timeout - required for SSE/WebSocket
  port: PORT,
  routes: {
    "/favicon.ico": new Response(null, { status: 204 }),  // Prevent 404 for favicon
    ...pluginRoutes,  // server.routes from plugins
  },
  ...(isDev && { development: { hmr: true } }),
  ...(websocket && { websocket }),
});

// Execute onServerStart hooks
registry.runOnServerStart(server);

// Graceful shutdown (SHUTDOWN_TIMEOUT_MS = 30_000ms = 30s)
process.on("SIGINT", async () => {
  const forceExitTimer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);

  try {
    await registry.runOnShutdown();
    pool.shutdown();
    await logger.flush();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
});
```

### Server Configuration Details

| Option | Value | Description |
|--------|-------|-------------|
| `idleTimeout` | `0` | Disables connection idle timeout. Required for SSE and WebSocket connections to stay open. |
| `routes["/favicon.ico"]` | `204 No Content` | Returns empty response for favicon requests to avoid unnecessary 404 logs. |
| `development.hmr` | `true` (dev only) | Enables Hot Module Replacement for faster development iteration. |

## Complete Diagram

```
                    ┌─────────────┐
                    │   bun dev   │  or  ./buntime
                    └──────┬──────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │            constants.ts               │
        │  - Validates PORT, NODE_ENV           │
        │  - Defines IS_DEV, IS_COMPILED        │
        └──────────────────┬───────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │              config.ts                │
        │  - Resolves RUNTIME_WORKER_DIRS       │
        │  - Resolves RUNTIME_PLUGIN_DIRS       │
        │  - Defines poolSize by environment    │
        └──────────────────┬───────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │              loader.ts                │
        │  - Scans RUNTIME_PLUGIN_DIRS          │
        │  - Loads manifest.yaml                │
        │  - Checks enabled in manifest         │
        │  - Loads plugin.ts                    │
        │  - Topological sort by dependencies   │
        └──────────────────┬───────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │               api.ts                  │
        │  - Creates logger (pretty/json)       │
        │  - Creates WorkerPool                 │
        │  - Mounts Hono routes                 │
        │  - OpenAPI/Scalar docs                │
        └──────────────────┬───────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │              index.ts                 │
        │  - Bun.serve({ port, hmr? })          │
        │  - registry.runOnServerStart()        │
        │  - Configures graceful shutdown       │
        └──────────────────────────────────────┘
                           │
                           ▼
                 ┌─────────────────┐
                 │  Server Ready   │
                 │  localhost:8000 │
                 └─────────────────┘
```

## Enabling/Disabling Plugins

Plugins are controlled by the `enabled` field in `manifest.yaml`:

``` yaml
# plugins/plugin-keyval/manifest.yaml
name: "@buntime/plugin-keyval"
base: "/keyval"
enabled: true  # or false to disable
```

Alternatively, via API:

``` bash
# List loaded plugins
curl http://localhost:8000/api/plugins/loaded

# Reload plugins (rescan)
curl -X POST http://localhost:8000/api/plugins/reload
```

## Troubleshooting

### Plugin not loading

**Symptom:** Plugin exists in RUNTIME_PLUGIN_DIRS but doesn't appear in routes.

**Possible causes:**
1. Plugin has `enabled: false` in manifest.yaml
2. Required dependency is not enabled
3. Initialization error (30s timeout)

**Solution:**

``` bash
# Check logs
bun dev 2>&1 | grep -i plugin

# Check manifest
cat plugins/plugin-name/manifest.yaml
```

### Environment variable not configured

**Symptom:** Error "workerDirs is required: set RUNTIME_WORKER_DIRS env var"

**Solution:**

``` bash
# Configure worker directories
export RUNTIME_WORKER_DIRS="./apps"

# Or multiple directories (PATH style)
export RUNTIME_WORKER_DIRS="/data/.apps:/data/apps"
```

### Incorrect pool size

**Symptom:** Workers terminating too quickly or high memory usage

**Solution:**

``` bash
# Adjust pool size
export RUNTIME_POOL_SIZE=50
```
