---
title: "Worker Pool"
audience: dev
sources:
  - apps/runtime/docs/concepts/worker-pool.md
  - .agents/rules/workers.md
updated: 2026-05-02
tags: [runtime, worker-pool, bun-workers, ttl, lru]
status: stable
---

# Worker Pool

Central component of the runtime. Manages the lifecycle of Bun workers that
run user apps in isolation. Provides reuse via LRU cache, health checks,
metrics, and graceful shutdown. Without it, every request would spin up a
worker from scratch.

For the routing pipeline that precedes the pool, see
[@buntime/runtime](./runtime.md). For plugins that hook into the pool via
`onWorkerSpawn`/`onWorkerTerminate`, see [Plugin System](./plugin-system.md).

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

### Components

| Component | Responsibility |
|-----------|----------------|
| `WorkerPool` | LRU cache (`quick-lru`), on-demand creation, eviction, health timers |
| `WorkerInstance` | Spawn `new Worker(wrapper.ts)`, IPC `postMessage`, timeout, status |
| `wrapper.ts` | Runs in the worker thread: `import(ENTRYPOINT)`, processes messages, injects `<base href>` |

### Execution Flow

```
Request → pool.fetch(appDir, config, req) → getOrCreate(key)
            ├─ Cache hit → instance.fetch(req)
            └─ Cache miss → new WorkerInstance → await READY → cache.set(key, …)
```

The public entry point is `pool.fetch()`. `getOrCreate()` is private and
manages the cache. Do not bypass it.

## Worker Lifecycle

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

### IPC Protocol

Structured messages via `postMessage` with `transferList` for zero-copy:

```typescript
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

Request/Response body travels as a transferable `ArrayBuffer`, avoiding copies.

## TTL — Sliding, not fixed

The TTL policy defines the entire personality of a worker:

| Policy | Behavior |
|--------|----------|
| `ttl = 0` | **Ephemeral**: worker discarded after each request. Boot per call. Higher latency. Use for stateless lambda-style handlers |
| `ttl > 0` | **Persistent**: worker reused. TTL is **sliding** — resets on each request via `touch()`. Use for apps with state, DB connections, SSE, WebSocket |

> [!IMPORTANT]
> Sliding TTL means the worker stays alive as long as it receives traffic. It
> only terminates when `ttlMs` passes with no requests, or when `maxRequests`
> is reached. It is not an absolute TTL from the time of creation.

### `idleTimeout` — notification only

`idleTimeout` does **NOT** terminate the worker. It only fires the `onIdle`
event in the app, giving it a chance to do partial cleanup (close DB
connections, flush caches). The worker remains in the cache until the TTL
actually expires.

```typescript
export default {
  fetch(req) { ... },
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

Hard limit on requests per worker, independent of TTL. Useful for mitigating
memory leaks that accumulate over hours. Default: `1000`.

## Worker App Manifest

`manifest.yaml` in the app directory defines the worker configuration:

```yaml
entrypoint: index.ts        # Default: auto-discovery
timeout: 30                 # or "30s", "5m", "1h"
ttl: 0                      # 0 = ephemeral
idleTimeout: 60             # notification only
maxRequests: 1000           # safety net
maxBodySize: "10mb"         # or number in bytes
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

## Environment Variables Passed to Workers

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

### Blocked Patterns

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

## Collision Detection

The pool indexes workers by key `name@version`. The same app appearing in two
different directories in `workerDirs`, or two apps with the same key, results
in an error:

```
Worker collision: "my-app@1.0.0" already registered from "/apps/my-app/v1",
cannot register from "/other/my-app/v1"
```

Resolution:

- Ensure unique `name@version`.
- Remove duplicates from `workerDirs`.
- Version conflicting apps differently.

## Health Checks

Periodic timer per worker. On each check, `instance.isHealthy()` validates:

| Criterion | Condition |
|-----------|-----------|
| Sliding TTL | `(now - ttlStartAt) < ttlMs` |
| Requests | `requestCount < maxRequests` |
| Critical errors | `hasCriticalError === false` |

Failure on any criterion → `pool.retire(key)` (removes from cache + terminates).

Timer interval: `Math.min(idleTimeoutMs, ttlMs) / 2`. Examples:

| `idleTimeoutMs` | `ttlMs` | Interval |
|-----------------|---------|----------|
| 120000 (2m) | 300000 (5m) | 60000 (1m) |
| 30000 (30s) | 30000 (30s) | 15000 (15s) |

### Critical Errors

Mark a worker as permanently unhealthy:

- Initialization timeout (`READY` not received within 30s).
- Import error (syntax error, module not found).
- Unhandled error during a request.

## Ephemeral Concurrency Control

For `ttl=0` apps, the pool has two global limits:

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Simultaneous requests in flight |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Queue depth before returning `503` |

Queue overflow returns `503 Service Unavailable`. Tune according to the app's
boot cost — apps with expensive startup should not use `ttl=0` under heavy load.

## Metrics

`pool.getMetrics()` exposes:

| Field | Description |
|-------|-------------|
| `activeWorkers` | Workers in the cache |
| `avgResponseTimeMs` | Average latency (last 100 requests, circular buffer) |
| `hitRate` / `hits` / `misses` | Cache hit rate |
| `evictions` | Total LRU evictions |
| `ephemeralConcurrency` / `ephemeralQueueDepth` / `ephemeralQueueLimit` | Ephemeral queue state |
| `memoryUsageMB` | Main process heap |
| `requestsPerSecond` | Observed rate |
| `totalRequests` / `totalWorkersCreated` / `totalWorkersFailed` / `totalWorkersRetired` | Totals |
| `uptimeMs` | Pool uptime |

`worker.getStats()` exposes per-instance: `ageMs`, `idleMs`, `requestCount`,
`errorCount`, `avgResponseTimeMs`, `status`, `totalResponseTimeMs`.

## Worker App — Supported Formats

`wrapper.ts` accepts three forms of default export:

### Fetch handler

```typescript
export default {
  fetch(req: Request) { return new Response("ok"); }
};
```

### Routes object

```typescript
export default {
  routes: {
    "/": new Response("Home"),
    "/api/users": (req) => fetch("..."),
    "/api/posts/:id": {
      GET: (req) => new Response(`Post ${req.params.id}`),
      DELETE: (req) => new Response(null, { status: 204 }),
    },
    "/file": Bun.file("./public/index.html"),  // BunFile/Blob also accepted
  },
};
```

The wrapper converts `routes` to Hono internally.

### SPA (HTML)

When `entrypoint` ends in `.html`, the wrapper serves it statically with
`<base href>` injection to allow SPA routing under a subpath. `index.ts` is
not executed in this case.

## Best Practices

| Do | Avoid |
|----|-------|
| `ttl > 0` for apps with state or expensive connections | `ttl = 0` for apps with heavy warmup |
| `idleTimeout` for partial cleanup via `onIdle` | Relying on `idleTimeout` to terminate the worker |
| `maxRequests` as a safety net | Global state in the worker (lost on recycle) |
| Appropriate `timeout` for slow operations | `autoInstall` in production (pre-install instead) |
| Tune `RUNTIME_EPHEMERAL_*` under load | Unlimited `ttl = 0` under burst traffic |

For shared state, externalize it (e.g. `@buntime/plugin-keyval` instead of a
global `Map` in the worker).

## Related Documentation

- [@buntime/runtime](./runtime.md) — request pipeline, env vars, startup.
- [Plugin System](./plugin-system.md) — `onWorkerSpawn`/`onWorkerTerminate` hooks.
- [Runtime API Reference](./runtime-api-reference.md) — `/api/workers/*` endpoints.
