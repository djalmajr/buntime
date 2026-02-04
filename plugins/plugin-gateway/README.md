# @buntime/gateway

API gateway extension for Buntime runner.

## Features

- **Micro-frontend shell** - Serve all navigations through a central shell app
- **Shell bypass** - Exclude specific apps from the shell (via env or cookie)
- Token bucket rate limiting
- Response caching (in-memory)
- CORS handling with preflight

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/gateway/stats` | Gateway stats |
| `POST /api/gateway/cache/invalidate` | Invalidate cache |

## Configuration

| Option | Type | Description |
|--------|------|-------------|
| `shellDir` | `string` | Path to the micro-frontend shell application |
| `shellExcludes` | `string` | Basenames that bypass the shell (comma-separated) |
| `rateLimit` | `RateLimitConfig` | Rate limiting config |
| `cache` | `CacheConfig` | Response caching config |
| `cors` | `CorsConfig` | CORS config |

### ShellConfig (Micro-frontend)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `shellDir` | `string` | `""` | Path to the micro-frontend shell application |
| `shellExcludes` | `string` | `"cpanel"` | Basenames that bypass the shell (comma-separated) |

**Environment Variables:**
- `GATEWAY_SHELL_DIR` - Path to shell app
- `GATEWAY_SHELL_EXCLUDES` - Basenames to bypass (comma-separated)

**Cookie Override:**
Users can set a `GATEWAY_SHELL_EXCLUDES` cookie to add per-user bypass basenames. The cookie value is combined with the env var.

**Example:**
```bash
# Environment
GATEWAY_SHELL_DIR=/data/apps/example-spa
GATEWAY_SHELL_EXCLUDES=cpanel,admin

# Cookie (adds dashboard to the bypass list for this user)
GATEWAY_SHELL_EXCLUDES=dashboard
```

### RateLimitConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requests` | `number` | `100` | Max requests per window |
| `window` | `string` | `"1m"` | Time window (`"30s"`, `"1m"`, `"1h"`) |
| `keyBy` | `"ip" \| "user" \| Function` | `"ip"` | Rate limit key |
| `excludePaths` | `string[]` | `[]` | Paths to skip (regex) |

### CacheConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ttl` | `number` | `60` | Cache TTL (seconds) |
| `methods` | `string[]` | `["GET"]` | Methods to cache |
| `maxEntries` | `number` | `1000` | Max cache entries |
| `excludePaths` | `string[]` | `[]` | Paths to skip (regex) |

### CorsConfig

| Option | Type | Description |
|--------|------|-------------|
| `origin` | `string \| string[]` | Allowed origins (`"*"` for all) |
| `methods` | `string[]` | Allowed methods |
| `allowedHeaders` | `string[]` | Allowed headers |
| `exposedHeaders` | `string[]` | Exposed headers |
| `credentials` | `boolean` | Allow credentials |
| `maxAge` | `number` | Preflight cache (seconds) |

## Usage

```jsonc
// plugins/plugin-gateway/manifest.jsonc
{
  "enabled": true,
  "rateLimit": {
    "requests": 100,
    "window": "1m",
    "keyBy": "ip"
  },
  "cache": {
    "ttl": 300,
    "methods": ["GET"]
  },
  "cors": {
    "origin": "*",
    "credentials": false
  }
}
```

## Priority

**15** - Rate limits and checks cache.
