---
title: Worker Pool
description: The LRU pool of isolated Bun workers — lifecycle, sliding TTL, ephemeral concurrency, isolation, and metrics.
sidebar:
  order: 2
---

The central component of the runtime. It manages the lifecycle of the Bun
workers that run user apps in isolation, providing reuse via an LRU cache,
health checks, metrics, and graceful shutdown. Without it, every request would
spin up a worker from scratch.

For the routing pipeline that precedes the pool, see
[Runtime](/concepts/runtime/). For plugins that hook into the pool via
`onWorkerSpawn`/`onWorkerTerminate`, see [Plugin System](/concepts/plugin-system/).

## Architecture

```
src/libs/pool/
├── pool.ts        # WorkerPool — LRU management, metrics
├── instance.ts    # WorkerInstance — IPC + individual lifecycle
├── wrapper.ts     # Code that runs inside the worker
├── config.ts      # Loading + validation of manifest.yaml
├── metrics.ts     # PoolMetrics
├── stats.ts       # Calculation helpers (avgResponseTime, etc.)
└── types.ts       # WorkerMessage, WorkerResponse, WorkerConfig
```

| Component | Responsibility |
|-----------|----------------|
| `WorkerPool` | LRU cache (`quick-lru`), on-demand creation, eviction, health timers |
| `WorkerInstance` | Spawn `new Worker(wrapper.ts)`, IPC `postMessage`, timeout, status |
| `wrapper.ts` | Runs in the worker thread: `import(ENTRYPOINT)`, processes messages, injects `<base href>` |

### Execution flow

```
Request → pool.fetch(appDir, config, req) → getOrCreate(key)
            ├─ Cache hit → instance.fetch(req)
            └─ Cache miss → new WorkerInstance → await READY → cache.set(key, …)
```

The public entry point is `pool.fetch()`. `getOrCreate()` is private and
manages the cache — do not bypass it.

## Worker lifecycle

```
Creating → Ready → Active ⇄ Idle → Terminated
```

| State | Condition |
|-------|-----------|
| `Creating` | `new Worker()` fired, waiting for `READY` |
| `Ready` | Worker loaded module, validated exports, sent `READY` |
| `Active` | Last request less than `idleTimeoutMs` ago |
| `Idle` | Last request more than `idleTimeoutMs` ago (worker stays alive) |
| `Ephemeral` | `ttl=0` mode — created and destroyed per request |
| `Offline` | Terminated or critically failed |

### IPC protocol

Structured messages via `postMessage` with a `transferList` for zero-copy:

```ts
// Main → Worker
type WorkerMessage =
  | { type: "REQUEST"; reqId: string; req: SerializedRequest }
  | { type: "IDLE" }
  | { type: "TERMINATE" };

// Worker → Main
type WorkerResponse =
  | { type: "READY" }
  | { type: "RESPONSE"; reqId: string; res: SerializedResponse }
  | { type: "ERROR"; reqId: string; error: string; stack?: string };
```

Request/Response bodies travel as a transferable `ArrayBuffer`, avoiding copies.

## Namespaces — `@namespace/app` addressing

Workers are addressed by name in the URL. A namespaced (npm-scoped) worker
`@namespace/app` — stored at `<workerDir>/@namespace/app/<version>/` — is
served at **`/@namespace/app/...`** (keep the `@`). An unscoped worker `app`
serves at `/app/...`. Namespaces give teams/environments a separate context:
`@example/checkout`, `@staging/api`, `@production/api`.

This is a *logical* grouping orthogonal to the *physical* multi-directory
support (`RUNTIME_WORKER_DIRS`): a namespace can live in any worker dir, and the
resolver scans them all. Plugins differ — they declare an explicit
single-segment `base` in their manifest, so their `@scope` only affects
storage/listing, not the served URL.

## Enabling / disabling a worker version

`manifest.enabled` (default `true`) gates whether a worker version is served.
When `false`, the version is treated as not-installed and the base path 404s —
no process restart needed. Toggle it via
`POST /api/workers/:scope/:name/:version/{enable,disable}`; the endpoint edits
the version's manifest and clears the worker-config cache so the next request
reflects it.

## TTL — sliding, not fixed

The TTL policy defines the entire personality of a worker:

| Policy | Behavior |
|--------|----------|
| `ttl = 0` | **Ephemeral**: worker discarded after each request. Boot per call. Higher latency. Use for stateless lambda-style handlers. |
| `ttl > 0` | **Persistent**: worker reused. TTL is **sliding** — it resets on each request via `touch()`. Use for apps with state, DB connections, SSE, WebSocket. |

:::caution[Sliding TTL]
A persistent worker stays alive as long as it receives traffic. It only
terminates when `ttlMs` passes with no requests, or when `maxRequests` is
reached. It is **not** an absolute TTL counted from creation time.
:::

### `idleTimeout` — notification only

`idleTimeout` does **not** terminate the worker. It only fires the `onIdle`
event in the app, giving it a chance to do partial cleanup (close DB
connections, flush caches). The worker remains in the cache until the TTL
actually expires.

```ts
export default {
  fetch(req) { /* ... */ },
  onIdle() {
    // Opportunistic cleanup — worker stays alive
    db.releaseConnection();
  },
  onTerminate() {
    // Before actual termination
    db.close();
  },
};
```

### Rules when `ttl > 0`

- `ttl >= timeout`
- `idleTimeout >= timeout`
- If `idleTimeout > ttl`, the runtime adjusts it to `ttl` with a warning.

### `maxRequests` — safety net

A hard limit on requests per worker, independent of TTL. Useful for mitigating
memory leaks that accumulate over hours. Default: `1000`.

## Worker app manifest

`manifest.yaml` in the app directory defines the worker configuration:

```yaml
entrypoint: index.ts        # Default: auto-discovery
timeout: 30                 # or "30s", "5m", "1h"
ttl: 0                      # 0 = ephemeral
idleTimeout: 60             # notification only
maxRequests: 1000           # safety net
maxBodySize: "10mb"         # or a number in bytes
lowMemory: false            # Bun --smol
autoInstall: false          # bun install --frozen-lockfile --ignore-scripts
visibility: public          # public | protected | internal
publicRoutes:               # auth bypass
  - /health
  - /api/public/**
env:                        # custom vars (filtered for sensitive values)
  API_URL: https://api.example.com
```

Supported duration formats for `timeout`, `ttl`, `idleTimeout`: `ms`, `s`,
`m`, `h`, `d`, `w`, `y`.

## Environment variables passed to workers

Workers **do not inherit** the runtime env. They receive only:

| Variable | Source |
|----------|--------|
| `APP_DIR` | runtime — absolute path to the app |
| `ENTRYPOINT` | runtime — entrypoint path |
| `WORKER_ID` | runtime — unique UUID |
| `WORKER_CONFIG` | runtime — JSON of `WorkerConfig` |
| `NODE_ENV` | inherited |
| `RUNTIME_*` | inherited (`RUNTIME_WORKER_DIRS`, `RUNTIME_PLUGIN_DIRS`, `RUNTIME_LOG_LEVEL`) |
| `RUNTIME_API_URL` | runtime — internal URL (e.g. `http://127.0.0.1:8000`) |
| `*` (from `manifest.env`) | manifest — after filtering sensitive patterns |
| `*` (from `.env`) | `.env` file in `appDir` — overrides `manifest.env` |

### Blocked patterns

Variables matching any pattern below are stripped before reaching the worker,
with a warning in the log:

| Pattern | Example |
|---------|---------|
| `^(DATABASE\|DB)_` | `DATABASE_URL`, `DB_HOST` |
| `^(API\|AUTH\|SECRET\|PRIVATE)_?KEY` | `API_KEY`, `AUTH_KEY` |
| `_TOKEN$` | `ACCESS_TOKEN` |
| `_SECRET$` | `JWT_SECRET` |
| `_PASSWORD$` | `DB_PASSWORD` |
| `^AWS_` / `^GITHUB_` / `^OPENAI_` / `^ANTHROPIC_` / `^STRIPE_` | Provider credentials |

## Isolation

Each worker runs in a separate thread with:

- **Independent heap** — separate GC, no leaks between apps.
- **Own module cache** — different versions of the same package coexist.
- **Scoped env** — `Bun.env` injected at spawn time, no global pollution.
- **`smol` mode** optional via `lowMemory: true` (smaller heap, more aggressive GC).
- **Path traversal blocked** — entrypoint validated to stay within `APP_DIR`.

## Collision detection

The pool indexes workers by key `name@version`. The same app appearing in two
different `workerDirs`, or two apps with the same key, results in an error:

```
Worker collision: "my-app@1.0.0" already registered from "/apps/my-app/v1",
cannot register from "/other/my-app/v1"
```

## Health checks

A periodic timer per worker. On each check, `instance.isHealthy()` validates:

| Criterion | Condition |
|-----------|-----------|
| Sliding TTL | `(now - ttlStartAt) < ttlMs` |
| Requests | `requestCount < maxRequests` |
| Critical errors | `hasCriticalError === false` |

Failure on any criterion → `pool.retire(key)` (removes from cache + terminates).

Timer interval: `Math.min(idleTimeoutMs, ttlMs) / 2`.

### Critical errors

These mark a worker as permanently unhealthy:

- Initialization timeout (`READY` not received within 30s).
- Import error (syntax error, module not found).
- Unhandled error during a request.

## Ephemeral concurrency control

For `ttl=0` apps, the pool enforces two global limits:

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Simultaneous requests in flight |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Queue depth before returning `503` |

Queue overflow returns `503 Service Unavailable`. Tune according to the app's
boot cost — apps with expensive startup should not use `ttl=0` under heavy load.

## Metrics

`pool.getMetrics()` exposes pool-wide counters: `activeWorkers`,
`avgResponseTimeMs`, `hitRate`/`hits`/`misses`, `evictions`,
`ephemeralConcurrency`/`ephemeralQueueDepth`/`ephemeralQueueLimit`,
`memoryUsageMB`, `requestsPerSecond`, and the `total*` lifetime counters.

`worker.getStats()` exposes per-instance: `ageMs`, `idleMs`, `requestCount`,
`errorCount`, `avgResponseTimeMs`, `status`, `totalResponseTimeMs`.

## Worker app — supported export shapes

`wrapper.ts` accepts three forms of default export:

```ts
// 1. Fetch handler
export default {
  fetch(req: Request) { return new Response("ok"); },
};

// 2. Routes object (converted to Hono internally)
export default {
  routes: {
    "/": new Response("Home"),
    "/api/posts/:id": {
      GET: (req) => new Response(`Post ${req.params.id}`),
      DELETE: () => new Response(null, { status: 204 }),
    },
    "/file": Bun.file("./public/index.html"),
  },
};

// 3. SPA — set entrypoint: index.html; the wrapper serves it statically
//    with <base href> injection. index.ts is NOT executed in this mode.
```

## Best practices

| Do | Avoid |
|----|-------|
| `ttl > 0` for apps with state or expensive connections | `ttl = 0` for apps with heavy warmup |
| `idleTimeout` for partial cleanup via `onIdle` | Relying on `idleTimeout` to terminate the worker |
| `maxRequests` as a safety net | Global state in the worker (lost on recycle) |
| Appropriate `timeout` for slow operations | `autoInstall` in production (pre-install instead) |
| Tune `RUNTIME_EPHEMERAL_*` under load | Unlimited `ttl = 0` under burst traffic |

For shared state, externalize it (e.g. [`@buntime/plugin-keyval`](/plugins/keyval/)
instead of a global `Map` in the worker).

## Related

- [Runtime](/concepts/runtime/) — request pipeline, env vars, startup.
- [Plugin System](/concepts/plugin-system/) — `onWorkerSpawn`/`onWorkerTerminate` hooks.
- [Runtime API Reference](/reference/api/) — `/api/workers/*` endpoints.
