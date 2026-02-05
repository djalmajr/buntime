# Overview

Gateway plugin that provides essential features for the Buntime runtime.

## Features

- **Rate Limiting** - Request rate control using Token Bucket algorithm
- **CORS** - Cross-Origin Resource Sharing configuration
- **Shell Routing** - Micro-frontend architecture support with central shell
- **Request Logging** - In-memory log of recent requests with filtering
- **Metrics Persistence** - Historical metrics storage via KeyVal integration
- **Response Caching** - In-memory response cache (disabled by default)

## Architecture

The plugin-gateway functions as middleware in the Buntime request pipeline:

```
Request
   │
   ▼
┌──────────────────────────────────────────────┐
│          GATEWAY PLUGIN (onRequest)          │
├──────────────────────────────────────────────┤
│  1. Shell Routing                            │
│     ├─ Document navigation → Shell           │
│     ├─ Root assets → Shell                   │
│     └─ Bypass check (env/cookie/KeyVal)      │
├──────────────────────────────────────────────┤
│  2. CORS Preflight                           │
│     └─ OPTIONS requests → CORS headers       │
├──────────────────────────────────────────────┤
│  3. Rate Limiting                            │
│     ├─ Check token bucket                    │
│     ├─ Exclude paths check                   │
│     ├─ Log rate-limited request              │
│     └─ 429 if exceeded                       │
├──────────────────────────────────────────────┤
│  4. Cache Check (disabled)                   │
│     └─ Return cached response if hit         │
└──────────────────────────────────────────────┘
   │
   ▼
Continue to next middleware/routes
   │
   ▼
┌──────────────────────────────────────────────┐
│         GATEWAY PLUGIN (onResponse)          │
├──────────────────────────────────────────────┤
│  1. Add CORS Headers                         │
│     ├─ Access-Control-Allow-Origin           │
│     ├─ Access-Control-Allow-Credentials      │
│     └─ Access-Control-Expose-Headers         │
└──────────────────────────────────────────────┘
   │
   ▼
Response
```

## Main Components

### 1. Rate Limiter

Token Bucket algorithm implementation:
- Bucket starts with maximum token capacity
- Each request consumes 1 token
- Tokens are refilled at a constant rate
- Requests are denied when no tokens are available
- Rate-limited requests are automatically logged

**File:** `server/rate-limit.ts`

### 2. CORS Handler

Manages CORS headers and preflight requests:
- Supports specific origins or wildcard (`*`)
- Configures allowed methods and headers
- Manages credentials and exposed headers
- Automatically responds to OPTIONS (preflight)

**File:** `server/cors.ts`

### 3. Shell Router

Routing system for micro-frontend:
- Central shell serves all document navigations
- Apps are loaded inside the shell via iframe
- Bypass support for specific apps (via env or cookie)
- Injects `<base href>` for relative assets
- Supports dynamic excludes via KeyVal persistence

**File:** `server/shell-bypass.ts`

### 4. Request Logger

Ring buffer that stores recent request information:
- Fixed-size buffer (100 entries by default)
- Logs IP, method, path, status, duration
- Tracks rate-limited requests
- Supports filtering by IP, status, rate-limited flag
- Provides statistics (total, rate-limited, status distribution)

**File:** `server/request-log.ts`

### 5. Persistence

KeyVal integration for storing persistent data:
- Metrics history (snapshots every 1 second)
- Shell excludes (dynamic bypass list)
- Automatic cleanup of old metrics
- Up to 3600 snapshots retained (1 hour)

**File:** `server/persistence.ts`

### 6. Response Cache

In-memory cache with LRU eviction (disabled by default):
- Stores responses by method:path:headers
- Configurable TTL per response
- Manual invalidation via API
- Regex pattern support for invalidation

**File:** `server/cache.ts`

## Tech Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Logging**: `@buntime/shared/logger`
- **Types**: TypeScript
- **Persistence**: KeyVal integration

## File Structure

```
plugins/plugin-gateway/
├── plugin.ts              # Main plugin implementation
├── manifest.yaml          # Configuration and schema
├── server/
│   ├── api.ts            # API routes (SSE, stats, config, metrics, logs)
│   ├── types.ts          # TypeScript interfaces
│   ├── rate-limit.ts     # Token Bucket rate limiter
│   ├── cors.ts           # CORS handling
│   ├── cache.ts          # Response cache (disabled)
│   ├── shell-bypass.ts   # Shell routing logic
│   ├── request-log.ts    # Request logging with ring buffer
│   └── persistence.ts    # KeyVal integration for metrics & excludes
├── client/               # UI (React + TanStack Router)
└── dist/                 # Compiled output
```

## Lifecycle Hooks

The plugin uses the following Buntime hooks:

### onInit

Initializes gateway components:
- Configures rate limiter (if enabled)
- Configures cache (if enabled)
- Loads shell configuration (if defined)
- Initializes persistence with KeyVal
- Loads persisted shell excludes
- Starts metrics snapshot collection
- Logs configuration

### onShutdown

Resource cleanup:
- Stops rate limiter cleanup interval
- Stops cache cleanup interval
- Stops metrics snapshot collection
- Closes persistence connections

### onRequest

Request processing pipeline:
1. Shell routing (if configured, checks env + KeyVal excludes)
2. CORS preflight
3. Rate limiting (logs blocked requests)
4. Cache check

### onResponse

Adds CORS headers to responses.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GATEWAY_SHELL_DIR` | Path to shell application | `""` |
| `GATEWAY_SHELL_EXCLUDES` | Basenames that bypass shell (non-removable) | `"cpanel"` |
| `GATEWAY_RATE_LIMIT_REQUESTS` | Max requests per window | `100` |
| `GATEWAY_RATE_LIMIT_WINDOW` | Time window | `"1m"` |
| `GATEWAY_CORS_ORIGIN` | Allowed origins | `"*"` |
| `GATEWAY_CORS_CREDENTIALS` | Allow credentials | `false` |

## API Routes

The plugin exposes routes at `/gateway/api/*`:

| Route | Method | Description |
|-------|--------|-------------|
| `/api/sse` | GET | Real-time SSE updates (stats, logs, metrics) |
| `/api/stats` | GET | Complete gateway statistics |
| `/api/config` | GET | Read-only configuration |
| `/api/rate-limit/metrics` | GET | Rate limiter metrics |
| `/api/rate-limit/buckets` | GET | Active token buckets (with limit query param) |
| `/api/rate-limit/buckets/:key` | DELETE | Clear specific bucket by key |
| `/api/rate-limit/clear` | POST | Clear all token buckets |
| `/api/metrics/history` | GET | Historical metrics from KeyVal (with limit query param) |
| `/api/metrics/history` | DELETE | Clear all historical metrics |
| `/api/shell/excludes` | GET | Get all shell excludes (env + KeyVal) |
| `/api/shell/excludes` | POST | Add shell exclude to KeyVal |
| `/api/shell/excludes/:basename` | DELETE | Remove shell exclude from KeyVal (env excludes cannot be removed) |
| `/api/logs` | GET | Get request logs (with query params: limit, ip, rateLimited, statusRange) |
| `/api/logs` | DELETE | Clear all request logs |
| `/api/logs/stats` | GET | Request log statistics |
| `/api/cache/invalidate` | POST | Invalidate cache by key or pattern (legacy, cache disabled) |

## Integration with Other Plugins

### plugin-keyval (optional)

If present, the gateway uses KeyVal for:
- **Metrics history** - Snapshots every 1 second, up to 3600 entries (1 hour)
- **Shell excludes** - Dynamic bypass list for micro-frontend shell

If KeyVal is not available, the gateway still functions but without persistence.

### plugin-authn (optional)

If present, the rate limiter can use the `X-Identity` header to identify users:

```yaml
rateLimit:
  keyBy: user  # Uses X-Identity header
```

### plugin-database (not used)

The gateway does not depend on a database.

## Next Steps

- [Rate Limiting](rate-limiting.md) - Token Bucket algorithm details
- [CORS](cors.md) - CORS configuration
- [Shell Routing](shell-routing.md) - Micro-frontend architecture
- [Configuration](../guides/configuration.md) - Complete reference
