---
name: architecture
summary: |
  - Monorepo: packages/ (libs), apps/ (runtime), plugins/ (core)
  - RUNTIME_WORKER_DIRS: colon-separated paths for workers (default: /data/.apps:/data/apps)
  - RUNTIME_PLUGIN_DIRS: colon-separated paths for plugins (default: /data/.plugins:/data/plugins)
  - LibSQL database for persistence (keyval, proxy rules, etc.)
  - Gateway plugin handles routing, CORS, rate limiting, app shell
  - RUNTIME_API_PREFIX moves only runtime internal API (/api -> /_/api), NOT plugin routes
---

# Buntime Architecture

## Project Structure

```
buntime/
├── packages/              # Shared libraries (bun workspaces)
│   ├── core/              # Core runtime logic
│   └── utils/             # Shared utilities
├── apps/
│   └── runtime/           # Main runtime application
│       ├── src/
│       │   ├── libs/      # Pool, plugin loader, etc.
│       │   └── index.ts   # Entry point
│       └── docs/          # Internal documentation
├── plugins/               # Core plugins (built into image)
│   ├── plugin-database/   # LibSQL adapter
│   ├── plugin-gateway/    # CORS, rate limit, app shell
│   ├── plugin-proxy/      # HTTP proxy rules
│   ├── plugin-keyval/     # Key-value store
│   ├── plugin-deployments/# App deployment management
│   └── ...
├── charts/                # Helm charts
│   ├── buntime/           # Main chart
│   └── libsql/            # LibSQL StatefulSet
└── scripts/               # Build & generation scripts
```

## Runtime Flow

```
Request
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│                        BUNTIME RUNTIME                       │
├──────────────────────────────────────────────────────────────┤
│  1. Plugin Middleware (onRequest)                            │
│     ├─ auth-token: JWT validation                            │
│     ├─ gateway: CORS, rate limiting                          │
│     └─ proxy: URL rewriting                                  │
├──────────────────────────────────────────────────────────────┤
│  2. Route Matching                                           │
│     ├─ /_/api/*     → Runtime internal API                   │
│     ├─ /database/*  → plugin-database routes                 │
│     ├─ /redirects/* → plugin-proxy routes                    │
│     ├─ /gateway/*   → plugin-gateway routes                  │
│     ├─ /app-name/*  → Worker pool (isolated)                 │
│     └─ /*           → App shell (if configured)              │
├──────────────────────────────────────────────────────────────┤
│  3. Plugin Middleware (onResponse)                           │
│     └─ Response transformations                              │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
Response
```

## Data Directories

| Path | Source | Content | Writable |
|------|--------|---------|----------|
| `/data/.apps` | Docker image | Core apps | No |
| `/data/.plugins` | Docker image | Core plugins | No |
| `/data/apps` | PVC | External apps (deployments) | Yes |
| `/data/plugins` | PVC | External plugins | Yes |

**Search order:** Core (`.apps`, `.plugins`) first, then external (`apps`, `plugins`)

## Key Components

### 1. Worker Pool

Manages isolated worker processes for running apps:
- Each app runs in its own worker
- Workers are pooled and reused (configurable TTL)
- Isolation via separate Bun processes

### 2. Plugin System

Plugins extend runtime functionality:
- **Core plugins:** Built into image, always available
- **External plugins:** Loaded from PVC at startup
- **Load order:** Respects dependencies in manifest

### 3. Gateway Plugin

Central routing and security:
- **App Shell:** Serves micro-frontend shell for all routes
- **CORS:** Configurable origins, methods, credentials
- **Rate Limiting:** Per-IP or custom key
- **Public Routes:** Bypass auth for specific patterns

### 4. Proxy Plugin

HTTP reverse proxy:
- **Rules:** Stored in LibSQL via keyval
- **Public Routes:** Per-rule bypass configuration
- **WebSocket:** Optional WS proxying

## API Prefix (RUNTIME_API_PREFIX)

When set (e.g., `/_`), moves **only the runtime internal API**:

| Without Prefix | With `/_` Prefix |
|----------------|------------------|
| `/api/health` | `/_/api/health` |
| `/api/plugins` | `/_/api/plugins` |
| `/api/workers` | `/_/api/workers` |

**Plugin routes are NOT affected:**

| Plugin | Route | With or Without Prefix |
|--------|-------|------------------------|
| proxy | `/redirects/api/rules` | Same |
| database | `/database/api/query` | Same |
| gateway | `/gateway/api/config` | Same |

**Note:** Plugin routes use their `base` path from manifest, independent of RUNTIME_API_PREFIX.

## Environment Variables

### Runtime Core

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port | `8000` |
| `NODE_ENV` | Environment | `production` |
| `RUNTIME_API_PREFIX` | API route prefix | `""` |
| `RUNTIME_WORKER_DIRS` | Worker search paths | `/data/.apps:/data/apps` |
| `RUNTIME_PLUGIN_DIRS` | Plugin search paths | `/data/.plugins:/data/plugins` |
| `RUNTIME_POOL_SIZE` | Max workers | `100` |
| `RUNTIME_LOG_LEVEL` | Log verbosity | `info` |

### Plugin: Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_LIBSQL_URL` | Primary LibSQL URL | `http://libsql:8080` |
| `DATABASE_LIBSQL_REPLICAS_N` | Replica URLs (N=1,2,...) | - |
| `DATABASE_LIBSQL_AUTH_TOKEN` | Auth token | - |

### Plugin: Gateway

| Variable | Description | Default |
|----------|-------------|---------|
| `GATEWAY_CORS_CREDENTIALS` | Allow credentials | `false` |
| `GATEWAY_CORS_ORIGIN` | Allowed origins | `*` |
| `GATEWAY_RATE_LIMIT_REQUESTS` | Max requests | `100` |
| `GATEWAY_RATE_LIMIT_WINDOW` | Time window | `1m` |
| `GATEWAY_SHELL_DIR` | App shell path | `""` |
| `GATEWAY_SHELL_EXCLUDES` | Basenames to bypass shell | `cpanel` |

### Plugin: Deployments

| Variable | Description | Default |
|----------|-------------|---------|
| `DEPLOYMENTS_EXCLUDES` | Excluded folders | `.cache, cli, runtime` |

## Proxy Rules

Rules are stored in LibSQL and managed via API:

```bash
# List rules
GET /redirects/api/rules

# Create rule
POST /redirects/api/rules
{
  "name": "API Proxy",
  "pattern": "^/api(/.*)?$",
  "target": "https://backend.example.com",
  "rewrite": "/api$1",
  "changeOrigin": true,
  "publicRoutes": {
    "GET": ["/api/config/**"]
  }
}

# Update rule
PUT /redirects/api/rules/{id}

# Delete rule
DELETE /redirects/api/rules/{id}
```

### Public Routes

Routes that bypass authentication:
```json
{
  "publicRoutes": {
    "GET": ["/api/config/**", "/api/health"],
    "POST": ["/api/webhook"]
  }
}
```

**Pattern matching:** Supports `**` (any path) and `*` (single segment)

## Development vs Production

| Aspect | Development (Docker) | Production (K8s) |
|--------|---------------------|------------------|
| Volumes | Local mounts | PVCs |
| Plugins | Source code mounted | Built into image + PVC |
| LibSQL | Container | StatefulSet |
| Ingress | localhost:8000 | Ingress + TLS |
| Hot Reload | Yes | No (rebuild) |

## Common Patterns

### Adding a New Core Plugin

1. Create `plugins/plugin-name/`
2. Add `manifest.yaml` with config schema
3. Implement `plugin.ts` (and optionally `index.ts`)
4. Run `bun scripts/generate-helm.ts`
5. Plugin auto-loads on startup

### Adding an External Plugin

1. Build plugin (`bun build plugin.ts --outdir dist`)
2. Copy to K8s: `kubectl cp manifest.yaml $POD:/data/plugins/plugin-name/`
3. Copy dist: `kubectl cp dist/plugin.js $POD:/data/plugins/plugin-name/dist/`
4. Restart: `kubectl rollout restart deployment/buntime`

### Debugging

```bash
# Check loaded plugins (runtime internal API - affected by RUNTIME_API_PREFIX)
curl /api/plugins          # or /_/api/plugins if prefix set

# Check worker status (runtime internal API)
curl /api/workers          # or /_/api/workers if prefix set

# View logs
kubectl logs -f deployment/buntime

# Check LibSQL data (plugin route - NOT affected by prefix)
curl /database/api/query -d '{"sql": "SELECT * FROM keyval"}'
```
