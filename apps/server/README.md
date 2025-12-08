# Buntime Server

Worker pool runtime for Bun applications, designed as the engine for a serverless application platform.

## Features

- **Worker Pool Management** - Dynamic spawning, configurable pool size, automatic lifecycle
- **Semantic Versioning** - Support for `app@1.0.0`, `app@1`, `app`
- **Extension System** - JSONC config, lifecycle hooks, priority ordering
- **Auth** - Keycloak/OIDC/JWT (AuthN) + XACML policies (AuthZ)
- **Monitoring** - SSE, Prometheus, per-worker stats

## Tech Stack

Bun, Hono, Zod, quick-lru, semver

## Project Structure

```
apps/server/
├── src/
│   ├── index.ts          # Entry point (Bun.serve)
│   ├── app.ts            # Hono app (routes aggregator)
│   ├── constants.ts      # Environment variables
│   ├── libs/
│   │   ├── dir-info.ts   # Directory operations
│   │   └── pool/         # Worker pool management
│   │       ├── pool.ts       # WorkerPool class & singleton
│   │       ├── instance.ts   # WorkerInstance lifecycle
│   │       ├── wrapper.ts    # Worker thread code
│   │       ├── config.ts     # Worker configuration
│   │       ├── metrics.ts    # Pool metrics
│   │       ├── types.ts      # Message types
│   │       └── preloads/
│   │           └── setup.ts  # Worker preload
│   ├── plugins/
│   │   ├── loader.ts     # Extension loader
│   │   └── registry.ts   # Extension registry
│   ├── routes/
│   │   ├── internal/     # /_/* routes
│   │   └── worker.ts     # /:app/* routes
│   └── utils/
│       ├── get-app-dir.ts
│       ├── get-entrypoint.ts
│       └── serve-static.ts
```

## Configuration

### buntime.jsonc

```jsonc
{
  "required": ["@buntime/metrics"],
  "plugins": [
    "@buntime/metrics",
    ["@buntime/authn", { "provider": "keycloak", ... }],
    ["@buntime/authz", { "store": "file", ... }]
  ]
}
```

### worker.jsonc (per app)

```jsonc
{
  "entrypoint": "public/index.html",
  "timeout": 30,
  "ttl": 60,
  "maxRequests": 1000,
  "idleTimeout": 60,
  "autoInstall": false,
  "lowMemory": false
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoInstall` | boolean | false | Run `bun install` before worker starts |
| `entrypoint` | string | auto | App entrypoint |
| `idleTimeout` | number | 60 | Idle threshold (seconds) |
| `lowMemory` | boolean | false | Enable low-memory mode |
| `maxRequests` | number | 1000 | Max requests before recycle |
| `timeout` | number | 30 | Request timeout (seconds) |
| `ttl` | number | 0 | Worker TTL (0 = no limit) |

## API Routes

### Internal (`/_/*`)

- `GET /_/deployments` - Deployment management
- `GET /_/metrics` - Pool metrics (JSON)
- `GET /_/sse` - SSE stream
- `GET /_/stats` - Full stats

### Extension (`/_/{name}/*`)

- `/_/metrics/prometheus`
- `/_/authn/well-known`
- `/_/authz/policies`

### Worker (`/`)

- `ALL /:app` - Route to app worker
- `ALL /:app/*` - Route nested paths

**Version Resolution:**
- `/hello-api` → Highest version
- `/hello-api@1.0.0` → Exact version
- `/hello-api@1` → Highest 1.x.x

## Scripts

```bash
bun dev              # Watch mode
bun lint             # Format + type check
bun test             # Run tests
bun build            # Build server
bun build:bin        # Compile to binary
```

## Architecture

### Request Flow

```
Request → Hono Router → Route?
  ├── /_/* → Internal Routes
  ├── /_/ext/* → Extension Routes
  └── /:app/* → Worker Pool → Worker Thread
```

### Design Principles

1. Main thread orchestrates, never executes app logic
2. Workers provide isolation (crash doesn't affect main)
3. Extension pipeline intercepts requests/responses

### Worker Lifecycle

```
Creating → Ready → Active ⟷ Idle → Terminated
```

## Key Components

| Component | Responsibility |
|-----------|----------------|
| `pool.ts` | WorkerPool class, LRU cache |
| `instance.ts` | WorkerInstance lifecycle |
| `wrapper.ts` | Worker request handling |
| `loader.ts` | Load extensions from config |
| `registry.ts` | Extension lifecycle |
