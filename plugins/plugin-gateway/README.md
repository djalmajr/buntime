# Plugin Gateway

Gateway plugin for Buntime that provides rate limiting, CORS, micro-frontend shell routing, request logging, and real-time monitoring.

## Table of Contents

- [Concepts](#concepts)
  - [Overview](docs/concepts/overview.md)
  - [Rate Limiting](docs/concepts/rate-limiting.md)
  - [CORS](docs/concepts/cors.md)
  - [Shell Routing](docs/concepts/shell-routing.md)
- [Guides](#guides)
  - [Configuration](docs/guides/configuration.md)
  - [Shell Setup](docs/guides/shell-setup.md)
- [Reference](#reference)
  - [API Reference](docs/api-reference.md)

## Concepts

### Overview

The plugin-gateway provides essential gateway features for Buntime, including rate limiting protection, CORS configuration, micro-frontend architecture support, request logging, and real-time monitoring via Server-Sent Events (SSE). See [Overview](docs/concepts/overview.md) for details.

### Rate Limiting

Token Bucket algorithm implementation to control request rate per client. Supports identification by IP, user, or custom function. See [Rate Limiting](docs/concepts/rate-limiting.md).

### CORS

Flexible CORS (Cross-Origin Resource Sharing) configuration to control access from different origins. See [CORS](docs/concepts/cors.md).

### Shell Routing

Routing system for micro-frontend architecture, where a central shell serves all browser navigations and loads specific apps via iframe. See [Shell Routing](docs/concepts/shell-routing.md).

## Guides

### Configuration

Complete reference for all plugin configuration options via manifest.yaml and environment variables. See [Configuration](docs/guides/configuration.md).

### Shell Setup

Step-by-step guide to configure the micro-frontend shell, including excludes and use cases. See [Shell Setup](docs/guides/shell-setup.md).

## Quick Start

```yaml
# plugins/plugin-gateway/manifest.yaml
name: "@buntime/plugin-gateway"
base: "/gateway"
enabled: true

# Rate limiting
rateLimit:
  requests: 100
  window: "1m"
  keyBy: ip
  excludePaths:
    - "/health"
    - "/_/api/health"

# CORS
cors:
  origin: "*"
  credentials: false
  methods:
    - GET
    - POST
    - PUT
    - DELETE

# Micro-frontend shell (optional)
# shellDir: /data/apps/example-spa
# shellExcludes: cpanel,admin
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GATEWAY_SHELL_DIR` | Path to shell application | `""` (disabled) |
| `GATEWAY_SHELL_EXCLUDES` | Basenames that bypass shell (comma-separated) | `"cpanel"` |
| `GATEWAY_RATE_LIMIT_REQUESTS` | Maximum requests per window | `100` |
| `GATEWAY_RATE_LIMIT_WINDOW` | Time window for rate limiting | `"1m"` |
| `GATEWAY_CORS_ORIGIN` | Allowed origins for CORS | `"*"` |
| `GATEWAY_CORS_CREDENTIALS` | Allow credentials in CORS | `false` |

## API Endpoints

### Monitoring & Real-time Updates

```bash
# Server-Sent Events (SSE) - Real-time gateway updates
GET /gateway/api/sse
# Streams real-time metrics, rate limit status, CORS config, shell excludes, and recent logs

# Gateway statistics (complete snapshot)
GET /gateway/api/stats
# Returns: rate limit metrics, CORS config, cache status, shell status, log statistics

# Read-only configuration
GET /gateway/api/config
```

### Rate Limiting

```bash
# Get rate limit metrics
GET /gateway/api/rate-limit/metrics

# List active rate limit buckets
GET /gateway/api/rate-limit/buckets?limit=100

# Clear specific rate limit bucket
DELETE /gateway/api/rate-limit/buckets/:key

# Clear all rate limit buckets
POST /gateway/api/rate-limit/clear
```

### Request Logs

```bash
# Get request logs (with optional filters)
GET /gateway/api/logs?limit=50&ip=192.168.1.1&rateLimited=true&statusRange=4

# Get log statistics
GET /gateway/api/logs/stats
# Returns: total requests, rate limited count, status distribution, average duration

# Clear all logs
DELETE /gateway/api/logs
```

### Metrics History

```bash
# Get historical metrics (from KeyVal persistence)
GET /gateway/api/metrics/history?limit=60
# Returns up to 3600 snapshots (1 hour at 1 snapshot/second)

# Clear metrics history
DELETE /gateway/api/metrics/history
```

### Shell Excludes Management

```bash
# List all shell excludes (env + keyval)
GET /gateway/api/shell/excludes

# Add a new exclude
POST /gateway/api/shell/excludes
{
  "basename": "admin"
}

# Remove an exclude (only keyval-based excludes)
DELETE /gateway/api/shell/excludes/:basename
```

### Cache (when enabled)

```bash
# Invalidate specific cache entry
POST /gateway/api/cache/invalidate
{
  "key": "GET:/api/users"
}

# Invalidate by pattern
POST /gateway/api/cache/invalidate
{
  "pattern": "^/api/.*"
}

# Clear entire cache
POST /gateway/api/cache/invalidate
{}
```

## Features

- **Rate Limiting** - Token Bucket algorithm with automatic refill
- **CORS** - Full CORS header configuration
- **Shell Routing** - Micro-frontend support with central shell
- **Shell Bypass** - Excludes via env var or cookie
- **Request Logging** - Ring buffer for recent requests with filtering
- **Real-time Monitoring** - SSE endpoint for live gateway statistics
- **Persistence** - Metrics history and shell excludes stored via KeyVal plugin
- **Statistics API** - Comprehensive monitoring and management endpoints

## Persistence via KeyVal Plugin

The gateway plugin optionally integrates with `@buntime/plugin-keyval` for persistent data storage:

- **Metrics History**: Automatic snapshots (1 per second) stored in KeyVal, up to 3600 entries (1 hour)
- **Shell Excludes**: Dynamic excludes stored in KeyVal (in addition to environment-based excludes)

When the KeyVal plugin is available, persistence features are automatically enabled.

## License

See [LICENSE](../../LICENSE) at the project root.
