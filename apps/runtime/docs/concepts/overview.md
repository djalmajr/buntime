# Overview

Worker pool runner for Bun applications, designed as an engine for a serverless platform.

## Features

- **Worker Pool Management** - Dynamic spawning, configurable pool size, automatic lifecycle
- **Semantic Versioning** - Support for `app@1.0.0`, `app@1`, `app@latest`
- **Plugin System** - YAML config, lifecycle hooks, topological ordering by dependencies
- **Base Path Injection** - SPA support under subpaths via `<base href>`

## Available Plugins

The runtime auto-discovers plugins from `pluginDirs`. Available plugins:

| Plugin | Description |
|--------|-------------|
| `@buntime/plugin-authn` | Authentication (Keycloak/OIDC/JWT, email-password) |
| `@buntime/plugin-authz` | Authorization with XACML policies |
| `@buntime/plugin-database` | Database adapters (libsql, sqlite) |
| `@buntime/plugin-deployments` | App management (upload, download, deletion) |
| `@buntime/plugin-gateway` | Cache, rate limiting, and shell routing |
| `@buntime/plugin-keyval` | Key-value store (Deno KV-like) |
| `@buntime/plugin-logs` | In-memory logs with SSE streaming |
| `@buntime/plugin-metrics` | Prometheus metrics and SSE |
| `@buntime/plugin-proxy` | Reverse proxy with dynamic rules |
| `@buntime/plugin-vhosts` | Virtual hosts for multi-tenancy |

> [!NOTE]
> Each plugin has its own `manifest.yaml` with configuration.
> The enabled/disabled state is controlled by the `enabled` field in the manifest.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Validation**: Zod
- **Cache**: quick-lru
- **Versioning**: semver
- **Database**: @libsql/client
- **API Docs**: hono-openapi, @scalar/hono-api-reference

## Project Structure

```
apps/runtime/
├── src/
│   ├── index.ts              # Entry point (Bun.serve)
│   ├── api.ts                # Hono app (route aggregator)
│   ├── app.ts                # Request resolution logic
│   ├── config.ts             # Runtime configuration
│   ├── constants.ts          # Constants and environment variables
│   ├── libs/
│   │   ├── openapi.ts        # OpenAPI schemas
│   │   ├── registry/
│   │   │   └── packager.ts   # Utilities for packaging plugins/apps
│   │   └── pool/             # Worker pool management
│   │       ├── pool.ts       # WorkerPool class, LRU cache
│   │       ├── instance.ts   # WorkerInstance lifecycle
│   │       ├── wrapper.ts    # Code executed in worker thread
│   │       ├── config.ts     # Worker configuration
│   │       ├── metrics.ts    # Pool metrics
│   │       ├── stats.ts      # Statistical utilities
│   │       └── types.ts      # Message types
│   ├── plugins/
│   │   ├── loader.ts         # Plugin loading
│   │   └── registry.ts       # Registry and plugin lifecycle
│   ├── routes/
│   │   ├── apps.ts           # /api/apps (app management)
│   │   ├── health.ts         # /api/health (health checks)
│   │   ├── plugins.ts        # /api/plugins (plugin management)
│   │   └── worker.ts         # App routes (/:app/*)
│   └── utils/
│       ├── get-worker-dir.ts # App version resolution
│       ├── get-entrypoint.ts # Entrypoint detection
│       ├── request.ts        # Body cloning, URL rewrite
│       └── serve-static.ts   # Static file serving
└── package.json
```

## Scripts

```bash
bun dev              # Watch mode with hot reload
bun lint             # Format + type check (lint:format && lint:types)
bun test             # Run tests
bun build            # Build runtime
bun build:bin        # Compile to binary
bun build:types      # Build TypeScript types
```

## Architecture

### Request Flow

```
Request -> Hono Router -> Resolve?
  |-- CSRF Protection
  |-- Plugin onRequest Hooks
  |-- /api/apps -> Apps API
  |-- /api/plugins -> Plugins API
  |-- /api/health -> Health API
  |-- /api/openapi.json -> OpenAPI spec
  |-- /api/docs -> Scalar API docs
  |-- Plugin server.fetch handlers
  |-- Plugin Routes (Hono)
  |-- Plugin Apps (via z-frame)
  +-- /:app/* -> Worker Pool -> Worker Thread
  +-- 404
```

### Design Principles

1. Main thread orchestrates, never executes app logic
2. Workers provide isolation (crash doesn't affect main)
3. Plugin pipeline intercepts requests/responses
4. Base path injection enables SPAs under subpaths
5. Topological ordering ensures plugin dependencies

### Worker Lifecycle

```
Creating -> Ready -> Active <-> Idle -> Terminated
```

## Main Components

| Component | Responsibility |
|-----------|----------------|
| `src/index.ts` | Entry point, Bun.serve, graceful shutdown |
| `src/api.ts` | Hono app, route aggregator, OpenAPI |
| `src/app.ts` | Request resolution, plugin apps |
| `src/config.ts` | Runtime configuration (environment variables) |
| `src/libs/pool/pool.ts` | WorkerPool class, LRU cache |
| `src/libs/pool/instance.ts` | WorkerInstance lifecycle |
| `src/libs/pool/wrapper.ts` | Request handling in worker, base injection |
| `src/plugins/loader.ts` | Loads plugins from filesystem |
| `src/plugins/registry.ts` | Lifecycle and plugin hooks |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8000` |
| `NODE_ENV` | Environment (development, production, staging, test) | `development` |
| `RUNTIME_WORKER_DIRS` | Worker directories (PATH style, separated by `:`) | **required** |
| `RUNTIME_PLUGIN_DIRS` | Plugin directories (PATH style, separated by `:`) | `./plugins` |
| `RUNTIME_POOL_SIZE` | Maximum worker pool size | env-based |
| `RUNTIME_LOG_LEVEL` | Log level (debug, info, warn, error) | `info` (prod) / `debug` (dev) |

### Pool Size by Environment

| Environment | Default |
|-------------|---------|
| development | 10 |
| staging | 50 |
| production | 500 |
| test | 5 |
