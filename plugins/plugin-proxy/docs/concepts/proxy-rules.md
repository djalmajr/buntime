# Proxy Rules

Deep dive into pattern matching, path rewriting, environment variable substitution, and public route configuration.

## Rule Schema

Each proxy rule contains the following fields:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Auto | Generated | Unique rule identifier |
| `name` | `string` | Yes | - | Human-readable name |
| `pattern` | `string` | Yes | - | Regex pattern to match request paths |
| `target` | `string` | Yes | - | Target URL (supports `${ENV_VAR}`) |
| `rewrite` | `string` | No | - | Path rewrite template with capture groups |
| `changeOrigin` | `boolean` | No | `false` | Change Host/Origin headers to target |
| `secure` | `boolean` | No | `true` | Verify SSL certificates |
| `ws` | `boolean` | No | `true` | Enable WebSocket proxying |
| `headers` | `object` | No | `{}` | Additional headers for proxied requests |
| `publicRoutes` | `object` | No | `{}` | Routes bypassing authentication per method |

## Pattern Matching

Patterns use standard JavaScript regular expressions. They are tested against the request pathname (not the full URL).

### Basic Patterns

```javascript
// Match exact path and all subpaths
"^/api(/.*)?$"
//  Matches: /api, /api/, /api/users, /api/users/123
//  No match: /api-v2, /other/api

// Match specific prefix
"^/legacy-api(/.*)?$"
//  Matches: /legacy-api, /legacy-api/endpoint
//  No match: /api, /legacy

// Match any path
"^/(.*)$"
//  Matches: everything
```

### Capture Groups

Capture groups `(...)` extract parts of the URL for use in rewrite templates:

```javascript
// Single capture group
"^/api(/.*)?$"
//  /api/users → $1 = "/users"
//  /api       → $1 = undefined (optional group)

// Multiple capture groups
"^/v(\\d+)/api(/.*)?$"
//  /v1/api/users → $1 = "1", $2 = "/users"
//  /v2/api       → $1 = "2", $2 = undefined

// Named-like capture (still positional)
"^/(\\w+)/api(/.*)?$"
//  /tenant1/api/data → $1 = "tenant1", $2 = "/data"
```

### Common Patterns

| Pattern | Matches | Use Case |
|---------|---------|----------|
| `^/api(/.*)?$` | `/api`, `/api/users` | API gateway |
| `^/ws(/.*)?$` | `/ws`, `/ws/chat` | WebSocket endpoint |
| `^/v(\\d+)/(.*)$` | `/v1/users`, `/v2/data` | Versioned API |
| `^/(\\w+)/api(/.*)?$` | `/tenant1/api/data` | Multi-tenant routing |
| `^/static/(.*)$` | `/static/js/app.js` | Static asset proxy |
| `^/(.*)$` | Everything | Catch-all proxy |

### Matching Order

Rules are tested in order. The first match wins:

```yaml
rules:
  # Rule 1: Specific path (checked first)
  - name: "Health Check"
    pattern: "^/api/health$"
    target: "https://health-service:3000"

  # Rule 2: General API (checked second)
  - name: "API Gateway"
    pattern: "^/api(/.*)?$"
    target: "https://api-service:3000"

  # Rule 3: Catch-all (checked last)
  - name: "Fallback"
    pattern: "^/(.*)$"
    target: "https://fallback-service:3000"
```

Request `/api/health` matches Rule 1 (not Rule 2, even though both match).

## Path Rewriting

The `rewrite` field defines how the matched path is transformed before forwarding to the target. Use `$1`, `$2`, etc. to reference captured groups.

### Rewrite Examples

```yaml
# Keep path as-is
pattern: "^/api(/.*)?$"
rewrite: "/api$1"
# /api/users → /api/users

# Strip prefix
pattern: "^/backend(/.*)?$"
rewrite: "$1"
# /backend/users → /users

# Add prefix
pattern: "^/api(/.*)?$"
rewrite: "/v2/api$1"
# /api/users → /v2/api/users

# Version routing
pattern: "^/v(\\d+)/api(/.*)?$"
rewrite: "/version/$1$2"
# /v1/api/data → /version/1/data
# /v2/api/users → /version/2/users

# Complete path replacement
pattern: "^/old-endpoint$"
rewrite: "/new/endpoint"
# /old-endpoint → /new/endpoint

# No rewrite (forward original path)
pattern: "^/api(/.*)?$"
# rewrite: omitted
# /api/users → /api/users (original path forwarded as-is)
```

### Rewrite Behavior

```
Request: GET /backend/api/users/123

Rule:
  pattern: "^/backend(/.*)?$"
  target: "https://api.internal:3000"
  rewrite: "$1"

Matching:
  "/backend/api/users/123" matches "^/backend(/.*)?$"
  $1 = "/api/users/123"

Rewrite:
  "$1" → "/api/users/123"

Final URL:
  https://api.internal:3000/api/users/123
```

### Optional Capture Groups

When a capture group is optional `(/.*)?` and the request matches without it, `$1` resolves to an empty string:

```yaml
pattern: "^/api(/.*)?$"
rewrite: "/v2$1"

# /api        → /v2       ($1 = "")
# /api/       → /v2/      ($1 = "/")
# /api/users  → /v2/users ($1 = "/users")
```

## Environment Variable Substitution

Target URLs support `${ENV_VAR}` syntax. Environment variables are resolved at request time.

### Usage

```yaml
rules:
  - name: "Backend API"
    pattern: "^/api(/.*)?$"
    target: "${BACKEND_URL}"
    rewrite: "/api$1"

  - name: "Auth Service"
    pattern: "^/auth(/.*)?$"
    target: "${AUTH_SERVICE_URL}"
    rewrite: "$1"
```

```bash
# .env
BACKEND_URL=https://api.internal:3000
AUTH_SERVICE_URL=https://auth.internal:4000
```

### Partial Substitution

Environment variables can be part of a larger URL:

```yaml
target: "https://${API_HOST}:${API_PORT}"
# API_HOST=api.internal, API_PORT=3000
# → https://api.internal:3000
```

### Missing Variables

If an environment variable is not set, the `${VAR}` placeholder remains in the URL as-is, which will likely cause a connection error. Always ensure required variables are set.

## Public Routes

Per-rule public routes define paths that bypass authentication. These are checked by the `plugin-authn` via the `isPublic()` service method.

### Configuration

```json
{
  "publicRoutes": {
    "ALL": ["/api/health"],
    "GET": ["/api/config/**"],
    "POST": ["/api/webhook"]
  }
}
```

### Method Keys

| Key | Description |
|-----|-------------|
| `ALL` | Matches any HTTP method |
| `GET` | Matches only GET requests |
| `POST` | Matches only POST requests |
| `PUT` | Matches only PUT requests |
| `DELETE` | Matches only DELETE requests |

### Path Matching

Public route paths support glob-like patterns:

```json
{
  "publicRoutes": {
    "GET": [
      "/api/health",           // Exact match
      "/api/config/**",        // Wildcard: any subpath
      "/api/public/*"          // Single segment wildcard
    ]
  }
}
```

### How It Works

```
Request: GET /api/health

1. Proxy plugin matches request to a rule
2. Auth plugin calls proxy.isPublic("/api/health", "GET")
3. Proxy checks publicRoutes:
   - "ALL": ["/api/health"] → MATCH
   - Result: isPublic = true
4. Auth plugin skips authentication
```

## Custom Headers

Add extra headers to proxied requests:

```yaml
rules:
  - name: "API with custom headers"
    pattern: "^/api(/.*)?$"
    target: "https://api.internal:3000"
    headers:
      X-Forwarded-By: buntime
      X-Request-Source: proxy
      Authorization: "Bearer ${API_TOKEN}"
```

Headers are added to the proxied request **in addition to** the original request headers. Custom headers override original headers with the same name.

## changeOrigin

When `changeOrigin: true`, the `Host` and `Origin` headers are rewritten to match the target:

```
Original request:
  Host: buntime.home
  Origin: https://buntime.home

With changeOrigin: true, proxied request:
  Host: api.internal:3000
  Origin: https://api.internal:3000

With changeOrigin: false (default), proxied request:
  Host: buntime.home (preserved)
  Origin: https://buntime.home (preserved)
```

**When to use `changeOrigin: true`:**
- Target server validates the Host header
- Target uses virtual hosting
- Target has CORS restrictions on Origin

## secure

When `secure: true` (default), SSL certificate verification is enabled for HTTPS targets. Set to `false` for self-signed certificates in development:

```yaml
rules:
  - name: "Dev Backend"
    pattern: "^/api(/.*)?$"
    target: "https://localhost:3443"
    secure: false  # Allow self-signed certs
```

> Setting `secure: false` in production is not recommended as it disables certificate validation.

## Next Steps

- [Overview](overview.md) - Architecture and request matching flow
- [WebSocket Proxying](websocket-proxying.md) - WebSocket upgrade and relay
- [Configuration](../guides/configuration.md) - Static and dynamic rules setup
- [API Reference](../api-reference.md) - Rule CRUD endpoints
