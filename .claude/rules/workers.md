---
name: workers
summary: |
  - Workers are isolated Bun processes running user apps
  - Pool manages worker lifecycle (create, reuse, terminate)
  - WorkerConfig: timeout, ttl, idleTimeout, maxRequests, maxBodySize
  - TTL=0: ephemeral (new worker per request), TTL>0: persistent (reused)
  - Workers receive limited env vars (sensitive vars blocked)
  - RUNTIME_WORKER_DIRS: colon-separated paths to search for apps
---

# Workers & Apps Guide

## Overview

Buntime runs user applications in isolated worker processes. The Worker Pool manages their lifecycle.

```
Request → Runtime → Worker Pool → Worker Process → App Code → Response
                         ↓
                    Pool manages:
                    - Creation
                    - Reuse (TTL > 0)
                    - Termination
                    - Metrics
```

## App Structure

Apps live in directories under `RUNTIME_WORKER_DIRS`:

```
/data/apps/
├── my-app/
│   ├── buntime.yaml     # Optional: worker config
│   ├── index.ts         # Entrypoint
│   ├── package.json
│   └── ...
└── another-app/
    └── index.ts
```

## Worker Config (buntime.yaml)

```yaml
# Optional configuration for the worker
entrypoint: index.ts        # Default: index.ts or index.js
timeout: 30                 # Request timeout in seconds (default: 30)
ttl: 0                      # Worker lifetime: 0 = ephemeral, >0 = persistent
idleTimeout: 60             # Seconds before idle worker terminates
maxRequests: 1000           # Max requests before worker recycles
maxBodySize: "10mb"         # Max request body size
lowMemory: false            # Enable low memory mode
autoInstall: false          # Auto-install dependencies (use --frozen-lockfile)

# Public routes (bypass auth)
publicRoutes:
  - /health
  - /api/public/**

# Visibility
visibility: public          # public | protected | internal

# Custom environment variables
env:
  MY_VAR: value
  API_URL: https://api.example.com
```

## Worker Modes

### Ephemeral (TTL = 0)

- **New worker for each request**
- Worker terminates after response
- Best for: Stateless APIs, Lambda-style functions
- Higher latency (cold start each time)

```yaml
ttl: 0
```

### Persistent (TTL > 0)

- **Worker reused across requests**
- Stays alive for `ttl` seconds
- Best for: Stateful apps, WebSocket, SSE
- Lower latency after first request

```yaml
ttl: 300          # 5 minutes
idleTimeout: 60   # Terminate if idle for 60s
maxRequests: 1000 # Recycle after 1000 requests
```

**Rules when TTL > 0:**
- `ttl >= timeout`
- `idleTimeout >= timeout`

## Worker Lifecycle

```
1. Request arrives for /my-app/...
2. Pool checks for existing worker
   ├─ Found & healthy → Reuse
   └─ Not found → Create new
3. Worker processes request
4. Response returned
5. If TTL=0 → Terminate
   If TTL>0 → Return to pool
6. Idle workers terminated after idleTimeout
```

## Environment Variables

### Passed to Workers

```bash
# Always passed
APP_DIR=/data/apps/my-app
ENTRYPOINT=index.ts
WORKER_ID=abc123
WORKER_CONFIG={"timeout":30,...}
NODE_ENV=production

# Runtime vars (RUNTIME_*)
RUNTIME_WORKER_DIRS=/data/.apps:/data/apps
RUNTIME_PLUGIN_DIRS=/data/.plugins:/data/plugins

# Custom from buntime.yaml env section
MY_VAR=value
```

### Blocked from Workers (Security)

These patterns are **never** passed to workers:

- `DATABASE_*`, `DB_*`
- `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`
- `AWS_*`, `GITHUB_*`, `OPENAI_*`, `ANTHROPIC_*`, `STRIPE_*`

## Pool Metrics

```typescript
interface PoolMetrics {
  cacheHitRate: number;       // Worker reuse rate
  cacheSize: number;          // Current pooled workers
  evictionCount: number;      // Workers evicted
  hitCount: number;           // Requests served by existing workers
  missCount: number;          // Requests requiring new workers
  requestCount: number;       // Total requests
  avgRequestDuration: number; // Average response time (ms)
  workerCreatedCount: number; // Total workers created
  workerFailedCount: number;  // Workers that crashed
}
```

Access via API:
```bash
GET /api/workers/metrics
```

## Worker Stats

Per-app statistics:

```typescript
interface WorkerStats {
  [appName: string]: {
    status: "active" | "idle" | "ephemeral" | "offline";
    requestCount: number;
    lastRequest: Date;
    createdAt: Date;
  };
}
```

Access via API:
```bash
GET /api/workers/stats
```

## App Routing

Requests are routed by first path segment:

```
/my-app/api/users → my-app worker
/another-app/     → another-app worker
/unknown/         → 404 (no matching app)
```

## App Entrypoint

Workers export a Hono app or fetch handler:

```typescript
// index.ts - Hono style
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.text("Hello"));
app.get("/api/users", (c) => c.json([{ id: 1 }]));

export default app;
```

```typescript
// index.ts - Fetch handler style
export default {
  fetch(req: Request): Response {
    return new Response("Hello");
  }
};
```

## Communication

Runtime ↔ Worker communication uses structured messages:

| Type | Direction | Purpose |
|------|-----------|---------|
| `REQUEST` | Runtime → Worker | HTTP request to process |
| `RESPONSE` | Worker → Runtime | HTTP response |
| `READY` | Worker → Runtime | Worker initialized |
| `ERROR` | Worker → Runtime | Worker error |
| `IDLE` | Runtime → Worker | Trigger idle callback |
| `TERMINATE` | Runtime → Worker | Graceful shutdown |

## Configuration Defaults

| Option | Default | Description |
|--------|---------|-------------|
| `entrypoint` | `index.ts` | Entry file |
| `timeout` | `30` | Request timeout (seconds) |
| `ttl` | `0` | Worker lifetime (0 = ephemeral) |
| `idleTimeout` | `60` | Idle termination (seconds) |
| `maxRequests` | `1000` | Requests before recycle |
| `maxBodySize` | `10mb` | Max request body |
| `lowMemory` | `false` | Low memory mode |
| `autoInstall` | `false` | Auto-install deps |
| `visibility` | `public` | Access level |

## Debugging Workers

```bash
# List all workers
GET /api/workers

# Get worker stats
GET /api/workers/stats

# Get pool metrics
GET /api/workers/metrics

# View runtime logs (includes worker lifecycle)
docker logs -f buntime
kubectl logs -f deployment/buntime
```
