---
title: "@buntime/runtime"
audience: dev
sources:
  - apps/runtime/README.md
  - apps/runtime/docs/concepts/overview.md
  - apps/runtime/docs/concepts/startup-flow.md
  - apps/runtime/docs/concepts/server-core.md
  - apps/runtime/docs/concepts/request-handling.md
  - apps/runtime/docs/concepts/routing.md
updated: 2026-05-02
tags: [runtime, bun, hono, server, lifecycle]
status: stable
---

# @buntime/runtime

Modular runtime for Bun with a worker pool, plugin system, and micro-frontend
support. The main process orchestrates requests but never executes application
code — that work is isolated in workers (see
[Worker Pool](./worker-pool.md)).

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun (`Bun.serve`, `Worker`, `Bun.file`) |
| HTTP Framework | Hono |
| Validation | Zod |
| LRU Cache | `quick-lru` |
| Versioning | `semver` |
| Internal DB | `@libsql/client` |
| API docs | `hono-openapi`, `@scalar/hono-api-reference` |

## Code Structure

```
apps/runtime/src/
├── index.ts            # Entry: Bun.serve + graceful shutdown
├── api.ts              # Initializes logger, config, pool, plugins, routes
├── app.ts              # Hono app: CSRF, hooks, request resolution
├── config.ts           # Loads RUNTIME_* env vars
├── constants.ts        # Zod validation of PORT/NODE_ENV, BodySizeLimits
├── libs/pool/          # WorkerPool, WorkerInstance, wrapper
├── plugins/            # PluginLoader, PluginRegistry
├── routes/             # apps, health, plugins, admin, worker
└── utils/              # request, serve-static, get-entrypoint, get-worker-dir
```

## Startup Flow

Initialization happens in layers, each depending on the previous one:

| Step | Module | Responsibility |
|------|--------|----------------|
| 1 | `constants.ts` | Validates `PORT`, `NODE_ENV`, `DELAY_MS`; defines `IS_DEV`, `IS_COMPILED` |
| 2 | `config.ts` | Resolves `RUNTIME_WORKER_DIRS` (required), `RUNTIME_PLUGIN_DIRS`, `RUNTIME_POOL_SIZE` |
| 3 | `loader.ts` | Scans `pluginDirs`, reads `manifest.yaml`, filters `enabled`, sorts by dependencies |
| 4 | `api.ts` | Creates logger, `WorkerPool`, `PluginRegistry`, mounts core routes and Hono `app` |
| 5 | `index.ts` | Starts `Bun.serve`, runs `runOnServerStart`, registers `SIGINT` handler |

### Environment Differences

| Aspect | Development | Production |
|--------|-------------|------------|
| `poolSize` | 10 | 500 |
| Logger | `pretty` (colored) | `json` (structured) |
| Log level | `debug` | `info` |
| HMR | Enabled | Disabled |

Other defaults: `staging` = 50 workers, `test` = 5.

## Server Core

`Bun.serve` is configured in `index.ts` with a few operational quirks:

| Option | Value | Reason |
|--------|-------|--------|
| `idleTimeout` | `0` | Disables timeout so SSE/WebSocket connections stay open |
| `routes["/favicon.ico"]` | `204 No Content` | Prevents 404s in logs |
| `routes` | `pluginRoutes` | `server.routes` aggregated from plugins |
| `development.hmr` | `true` (dev) | Hot Module Replacement |
| `websocket` | combined | Single handler aggregating all plugins |

### Graceful Shutdown

`SIGINT` triggers a pipeline with a total timeout of 30s (`SHUTDOWN_TIMEOUT_MS`):

1. Arms a force-exit timer (`process.exit(1)` in 30s).
2. `registry.runOnShutdown()` — plugin hooks in reverse order (LIFO).
3. `pool.shutdown()` — terminates all workers.
4. `logger.flush()`.
5. `clearTimeout` + `process.exit(0)`.

Any failure in the chain falls to the `catch` block and forces exit code 1.

## Request Handling

### Pipeline in `app.ts`

```
Request -> CSRF (/api/*) -> onRequest hooks -> server.fetch -> plugin.routes
        -> plugin app (worker) -> worker app -> onResponse hooks -> Response
```

### CSRF

Applied to `/api/*` for state-mutating methods (POST, PUT, PATCH, DELETE):

| Condition | Behavior |
|-----------|----------|
| Method in `[GET, HEAD, OPTIONS]` | Bypass |
| Header `X-Buntime-Internal: true` | Bypass (worker → runtime) |
| `Sec-Fetch-Mode` present without `Origin` | 403 |
| `Origin.host !== request.host` | 403 |

### Body Size Limits

Constants in `constants.ts`: `DEFAULT = 10MB`, `MAX = 100MB`. Configurable via
env (`BODY_SIZE_DEFAULT`, `BODY_SIZE_MAX`) and per worker in `manifest.yaml`
(`maxBodySize: 50mb`). If `maxBodySize > MAX`, the runtime emits a warning and
uses `MAX`.

Validation happens in two steps:

1. Fast path: invalid `Content-Length` or larger than limit → `413 Payload Too Large`.
2. Slow path (chunked): full read, recheck of actual size.

Everything returns `BodyTooLargeError` in application code. The response
includes the `X-Request-Id` header for log correlation.

### URL Rewriting

`rewriteUrl(url, basePath)` removes the path prefix while preserving the query
string — used before injecting into the worker. The function assumes the path
starts with `basePath` (validated upstream). Special cases:

| Input | Result |
|-------|--------|
| `basePath = ""` | Returns original pathname |
| `pathname === basePath` | Returns `"/"` |
| `pathname` does not start with `basePath` | Undefined behavior — validate upstream |

### Special Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-Base` | runtime → worker | Base path injected for SPAs |
| `X-Buntime-Internal` | worker → runtime | Bypasses CSRF |
| `X-Not-Found` | runtime → shell | Signals consistent 404 rendering |
| `X-Request-Id` | bidirectional | Correlation UUID |

## Routing — Multi-layer

Resolution in `app.ts` follows a strict priority order. More specific routes
(plugins) take precedence over generic ones (workers):

| Order | Layer | Example |
|-------|-------|---------|
| 1 | CSRF | Block before everything else |
| 2 | App-shell mode | `shouldRouteToShell()` intercepts navigation |
| 3 | `onRequest` hooks | Auth, rate limiting, metrics |
| 4 | Runtime APIs | `/api/*` (or `/_/api/*` with `RUNTIME_API_PREFIX`) |
| 5 | `plugin.server.fetch` | Direct plugin handler |
| 6 | `plugin.routes` | Hono mounted at `plugin.base`, sorted by specificity (longest path first) |
| 7 | Plugin apps | Worker pool (z-frame iframes) |
| 8 | Worker apps | `/:app/*` in `workerDirs` |
| 9 | Homepage fallback | Tries to serve from `homepage.app` |
| 10 | 404 | Text `Buntime v{version}` or shell 404 |

### Shell Routing

`shouldRouteToShell(req)` decides whether navigation goes to the shell (cpanel):

| Condition | Result |
|-----------|--------|
| `Sec-Fetch-Mode !== "navigate"` | Reject (fetch/XHR does not go through the shell) |
| Path contains `/api/` | Reject |
| Path is `/` or empty | Accept |
| Path matches `plugin.base` | Accept |

Runs **after** `onRequest`, allowing auth to be processed before the routing
decision.

### Worker Apps with Semver

Workers live in `workerDirs` in two formats:

```
# Flat
apps/my-app@1.0.0/

# Nested
apps/my-app/1.0.0/
```

Version resolution uses `semver`:

| Request | Resolves to |
|---------|-------------|
| `/my-app/*` | `latest` if it exists, otherwise highest version |
| `/my-app@1/*` | Highest `1.x.x` |
| `/my-app@1.0/*` | Highest `1.0.x` |
| `/my-app@1.0.0/*` | Exact version |
| `/my-app@^1.0.0/*` | Semver range |
| `/my-app@latest/*` | Literal `latest` directory |

### Entrypoint Detection

`getEntrypoint(appDir, manifestEntry?)` applies priority:

1. `entrypoint` from `manifest.yaml`.
2. Auto-discovery: `index.html` → `index.ts` → `index.js` → `index.mjs`.

Entrypoint type determines behavior:

| Type | `static` | Execution |
|------|----------|-----------|
| `index.html` | `true` | `serveStatic` + `<base href>` injection |
| `index.{ts,js,mjs}` | `false` | Loaded as worker, runs `fetch()` or `routes` |

`serveStatic` validates path traversal (`resolve()` must stay within
`baseDir`) and falls back to `entrypoint` for SPA routing.

### Homepage Fallback

When a `homepage = { app, base: "/" }` is configured, requests that return 404
from workers attempt to serve from the homepage app. Useful for SPAs at the
root that need to load chunks with arbitrary paths.

## Reserved Paths

External plugins cannot occupy:

- `/api`
- `/health`
- `/.well-known`

Plugin base paths must match `/[a-zA-Z0-9_-]+`.

## Core API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | General health |
| `/api/health/ready` | GET | Readiness probe (k8s) |
| `/api/health/live` | GET | Liveness probe (k8s) |
| `/api/apps` | GET | List apps in `workerDirs` |
| `/api/apps/upload` | POST | Upload tarball/zip |
| `/api/apps/:scope/:name[/:version]` | DELETE | Remove app/version |
| `/api/plugins` | GET | List plugins on the filesystem |
| `/api/plugins/loaded` | GET | List loaded plugins |
| `/api/plugins/reload` | POST | Re-scan and reload |
| `/api/plugins/upload` | POST | Upload a plugin |
| `/api/plugins/:name` | DELETE | Remove a plugin |
| `/api/admin/session` | GET | Validates `X-API-Key`, returns permissions |
| `/api/keys` | GET/POST | List/create API keys |
| `/api/keys/:id` | DELETE | Revoke a key |
| `/api/openapi.json` | GET | OpenAPI 3.1 spec |
| `/api/docs` | GET | Scalar UI |

Full details in [Runtime API Reference](./runtime-api-reference.md).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | HTTP port |
| `NODE_ENV` | `development` | `development` \| `production` \| `staging` \| `test` |
| `RUNTIME_WORKER_DIRS` | **required** | App directories (PATH style, `:`) |
| `RUNTIME_PLUGIN_DIRS` | `./plugins` | Plugin directories |
| `RUNTIME_POOL_SIZE` | env-based | Maximum pool size |
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Maximum concurrency for `ttl: 0` |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Maximum queue for `ttl: 0` before 503 |
| `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` | Manifest cache TTL |
| `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` | Resolver cache TTL |
| `RUNTIME_LOG_LEVEL` | `info` (prod) / `debug` (dev) | Log level |
| `RUNTIME_API_PREFIX` | (empty) | Moves internal API: `""` → `/api`, `"/_"` → `/_/api` |
| `RUNTIME_MASTER_KEY` | (optional) | Bootstrap admin key |
| `RUNTIME_STATE_DIR` | (optional) | Where to store `api-keys.json` |
| `DELAY_MS` | `100` | Delay before terminating a worker |

> Multi-values **always** use `:` (PATH style), never commas.

## Design Principles

1. **Main thread orchestrates, never executes app code**. Worker crashes do not bring down the runtime.
2. **Workers enforce isolation** — separate heap, modules, and env per instance.
3. **Plugin pipeline intercepts** request/response without coupling plugins to each other.
4. **Base path injection** enables SPAs under subpaths without reconfiguring bundlers.
5. **Topological sort** orders plugins by dependencies before `onInit`.

## Related Documentation

- [Worker Pool](./worker-pool.md) — LRU, lifecycle, sliding TTL, ephemeral concurrency.
- [Plugin System](./plugin-system.md) — hooks, persistent vs serverless modes, manifest.
- [Micro-Frontend Architecture](./micro-frontend.md) — z-frame, MessageChannel, isolation.
- [Runtime API Reference](./runtime-api-reference.md) — endpoints, authentication, curl examples.
