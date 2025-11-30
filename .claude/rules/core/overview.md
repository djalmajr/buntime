# Buntime Overview

## Objective

Buntime is a worker pool runtime for Bun applications. It provides:

**Worker Pool Management:**
- Dynamic worker spawning based on app requests
- Configurable max pool size
- Automatic worker lifecycle management

**Semantic Versioning:**
- Support for `app@1.0.0`, `app@1`, `app`
- Fallback to highest version if specific version not found
- Version sorting (highest version selected when no version specified)

**Real-time Monitoring:**
- SSE endpoint for live metrics
- Pool metrics (active workers, queue size, etc.)
- Per-worker statistics

**Type Safety:**
- Full TypeScript support
- Zod validation for runtime type safety

**Unified Request Pipeline:**
- Static apps (HTML) served through workers for isolation
- Proxy rules with regex pattern matching and path rewriting (HTTP & WebSocket)
- All requests go through same pipeline (static, dynamic, proxy)

## Tech Stack

- Bun runtime
- Hono (web framework)
- Zod (validation)
- quick-lru (caching)
- semver (version resolution)

## API Routes

### Internal Routes (prefix: `/_`)

- `GET /_/deployments` - Deployment management
- `GET /_/metrics` - Get worker pool metrics (JSON)
- `GET /_/sse` - Server-Sent Events stream (real-time metrics)
- `GET /_/stats` - Get pool + workers stats (JSON)

### Worker Routes (prefix: `/`)

- `ALL /:app` - Route request to app worker or proxy
- `ALL /:app/*` - Route nested paths to app worker or proxy

**Version Resolution:**
- `/hello-api` → Highest version in `APPS_DIR/hello-api/`
- `/hello-api@1.0.0` → Exact version `APPS_DIR/hello-api/1.0.0/`
- `/hello-api@1` → Highest version compatible with 1.x.x

## Worker Configuration (worker.config.json)

Apps can be configured via `worker.config.json` in the app directory:

```json
{
  "entrypoint": "public/index.html",
  "timeout": 30,
  "ttl": 60,
  "proxy": {
    "^/api/v(\\d+)/(.*)$": {
      "target": "${API_URL}",
      "rewrite": "/version/$1/$2",
      "changeOrigin": true,
      "secure": false,
      "headers": { "X-Custom": "value" }
    }
  }
}
```

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entrypoint` | string | auto | App entrypoint (searched: index.html, index.ts, index.js, index.mjs) |
| `timeout` | number | 30 | Request timeout in seconds |
| `ttl` | number | 0 | Worker time-to-live in seconds (0 = no caching) |
| `idleTimeout` | number | 60 | Idle threshold before worker is marked stale |
| `maxRequests` | number | 1000 | Max requests before worker reuse |
| `lowMemory` | boolean | false | Enable low-memory mode |
| `proxy` | object | - | Proxy rules for forwarding requests |

**Entrypoint Resolution:**

1. If `entrypoint` is set in config, use it
2. Otherwise search in order: `index.html` → `index.ts` → `index.js` → `index.mjs`
3. If entrypoint is `.html`, app is served as static (inside worker for isolation)
4. All apps get automatic `/health` endpoint (handled inside worker - returns OK only if worker is alive)

**Proxy Configuration:**

```json
{
  "proxy": {
    "^/api/(.*)$": {
      "target": "http://backend:3000",
      "rewrite": "/v1/$1",
      "changeOrigin": true,
      "secure": false,
      "headers": { "X-Custom": "value" }
    }
  }
}
```

| Option | Type | Description |
|--------|------|-------------|
| `target` | string | Target URL (supports `${ENV_VAR}` syntax) |
| `rewrite` | string | Path rewrite using regex capture groups (`$1`, `$2`, etc.) |
| `changeOrigin` | boolean | Change Host/Origin headers to target |
| `secure` | boolean | Verify SSL certificates (default: true) |
| `headers` | object | Additional headers to send |

**Pattern Matching:**
- Patterns are JavaScript regular expressions
- Use capture groups `()` to extract parts of the path
- Use `$1`, `$2`, etc. in rewrite to reference captured groups

**Rewrite Examples:**
- Pattern `^/api/(.*)$`, rewrite `/v1/$1`: `/api/users` → `/v1/users`
- Pattern `^/api/v(\\d+)/(.*)$`, rewrite `/version/$1/$2`: `/api/v2/users` → `/version/2/users`
- Pattern `^/_api/login$`, rewrite `/auth/login`: `/_api/login` → `/auth/login`

## Scripts

**Testing & Linting:**
```bash
bun lint             # Format and type check
bun lint:format      # Format with Biome
bun lint:types       # Type check with TypeScript
bun test             # Run tests
bun test:coverage    # Run tests with coverage
bun test:watch       # Run tests in watch mode
```

## Path Aliases (tsconfig.json)

```json
{
  "@/*": ["./src/*"]
}
```

**Usage:**
- Use `@/libs/proxy` instead of `../../libs/proxy`

## Development Workflow

1. **Install dependencies:**
```bash
bun install
```

2. **Run server:**
```bash
bun server.ts
```

3. **Test worker apps:**
```
http://localhost:8080/<app-name>
```

## Testing

**Run tests:**
```bash
bun test              # All tests
bun test:coverage     # With coverage
bun test:watch        # Watch mode
bun test libs/proxy   # Specific file/directory
```
