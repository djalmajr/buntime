# Configuration

Complete reference for all plugin-proxy configuration options.

## Configuration Methods

### 1. manifest.yaml (Static Rules)

Static rules defined in the manifest are read-only at runtime. They cannot be modified or deleted via the API.

```yaml
# plugins/plugin-proxy/manifest.yaml
name: "@buntime/plugin-proxy"
base: "/redirects"
enabled: true
injectBase: true

dependencies:
  - "@buntime/plugin-keyval"

entrypoint: dist/client/index.html
pluginEntry: dist/plugin.js

menus:
  - icon: lucide:network
    path: /redirects
    title: Redirects

rules:
  - name: "API Gateway"
    pattern: "^/api(/.*)?$"
    target: "https://api.internal:3000"
    rewrite: "/api$1"
    changeOrigin: true

  - name: "WebSocket"
    pattern: "^/ws(/.*)?$"
    target: "ws://realtime:8080"
    rewrite: "$1"
    ws: true
```

### 2. REST API (Dynamic Rules)

Dynamic rules created via the API are persisted in KeyVal and survive restarts. See [API Reference](../api-reference.md) for endpoints.

```bash
# Create dynamic rule
curl -X POST http://localhost:8000/redirects/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "External API",
    "pattern": "^/external(/.*)?$",
    "target": "https://external-service.com",
    "rewrite": "$1",
    "changeOrigin": true
  }'
```

## Configuration Options

### rules

Array of static proxy rules.

- **Type:** `ProxyRule[]`
- **Default:** `[]`

Each rule has the following fields:

#### name

Human-readable name for the rule.

- **Type:** `string`
- **Required:** Yes

```yaml
name: "API Gateway"
```

#### pattern

JavaScript regex pattern to match request paths.

- **Type:** `string`
- **Required:** Yes

```yaml
pattern: "^/api(/.*)?$"
```

See [Proxy Rules](../concepts/proxy-rules.md) for pattern matching details.

#### target

Target URL to proxy to. Supports `${ENV_VAR}` substitution.

- **Type:** `string`
- **Required:** Yes

```yaml
# Direct URL
target: "https://api.internal:3000"

# Environment variable
target: "${BACKEND_URL}"

# Mixed
target: "https://${API_HOST}:${API_PORT}"
```

#### rewrite

Path rewrite template using capture group references (`$1`, `$2`).

- **Type:** `string`
- **Required:** No
- **Default:** Original path is forwarded as-is

```yaml
# Strip prefix
rewrite: "$1"

# Keep prefix
rewrite: "/api$1"

# Add prefix
rewrite: "/v2/api$1"
```

See [Proxy Rules](../concepts/proxy-rules.md) for rewrite details.

#### changeOrigin

Rewrite `Host` and `Origin` headers to match the target host.

- **Type:** `boolean`
- **Default:** `false`

```yaml
changeOrigin: true
```

**When to enable:**
- Target validates the Host header
- Target uses virtual hosting
- Target has strict CORS configuration

#### secure

Verify SSL certificates on the target.

- **Type:** `boolean`
- **Default:** `true`

```yaml
secure: false  # Disable for self-signed certs
```

> Do not disable in production unless you understand the security implications.

#### ws

Enable WebSocket proxying for this rule.

- **Type:** `boolean`
- **Default:** `true`

```yaml
ws: true
```

See [WebSocket Proxying](../concepts/websocket-proxying.md) for details.

#### headers

Additional headers to send with proxied requests. These are added to (and can override) the original request headers.

- **Type:** `Record<string, string>`
- **Default:** `{}`

```yaml
headers:
  X-Forwarded-By: buntime
  X-Request-Source: proxy
  Authorization: "Bearer ${API_TOKEN}"
```

#### publicRoutes

Routes that bypass authentication, organized by HTTP method. Used by `plugin-authn` via the `isPublic()` service method.

- **Type:** `Record<string, string[]>`
- **Default:** `{}`

```yaml
publicRoutes:
  ALL:
    - "/api/health"
  GET:
    - "/api/config/**"
  POST:
    - "/api/webhook"
```

## Static vs Dynamic Rules

| Aspect | Static (manifest) | Dynamic (API) |
|--------|-------------------|---------------|
| **Defined in** | `manifest.yaml` | REST API |
| **Persistence** | Always available | KeyVal (requires plugin-keyval) |
| **Modifiable** | No | Yes (CRUD) |
| **Evaluation order** | First | After static |
| **Marked as** | `readonly: true` | `readonly: false` |
| **Use case** | Core routing, infrastructure | Ad-hoc services, A/B testing |

## Complete Examples

### API Gateway

Route all API traffic to an internal service:

```yaml
name: "@buntime/plugin-proxy"
enabled: true
rules:
  - name: "API Gateway"
    pattern: "^/api(/.*)?$"
    target: "https://api.internal:3000"
    rewrite: "/api$1"
    changeOrigin: true
    publicRoutes:
      GET:
        - "/api/health"
        - "/api/version"
```

### Microservices

Route to multiple backend services:

```yaml
name: "@buntime/plugin-proxy"
enabled: true
rules:
  - name: "Auth Service"
    pattern: "^/auth(/.*)?$"
    target: "${AUTH_URL}"
    rewrite: "$1"
    changeOrigin: true
    publicRoutes:
      POST:
        - "/auth/login"
        - "/auth/register"

  - name: "Users Service"
    pattern: "^/users(/.*)?$"
    target: "${USERS_URL}"
    rewrite: "$1"
    changeOrigin: true

  - name: "Payments Service"
    pattern: "^/payments(/.*)?$"
    target: "${PAYMENTS_URL}"
    rewrite: "$1"
    changeOrigin: true
    publicRoutes:
      POST:
        - "/payments/webhook"
```

```bash
# .env
AUTH_URL=https://auth.internal:4000
USERS_URL=https://users.internal:4001
PAYMENTS_URL=https://payments.internal:4002
```

### WebSocket + HTTP

Combined HTTP and WebSocket proxying:

```yaml
name: "@buntime/plugin-proxy"
enabled: true
rules:
  - name: "API"
    pattern: "^/api(/.*)?$"
    target: "https://backend:3000"
    rewrite: "/api$1"
    changeOrigin: true
    ws: false  # HTTP only

  - name: "Realtime"
    pattern: "^/ws(/.*)?$"
    target: "ws://realtime:8080"
    rewrite: "$1"
    ws: true  # WebSocket enabled
```

### Legacy Migration

Gradually migrate traffic from old to new endpoints:

```yaml
name: "@buntime/plugin-proxy"
enabled: true
rules:
  # New API (priority: evaluated first)
  - name: "New API"
    pattern: "^/v2/api(/.*)?$"
    target: "https://new-api:3000"
    rewrite: "$1"
    changeOrigin: true

  # Legacy API (evaluated second)
  - name: "Legacy API"
    pattern: "^/api(/.*)?$"
    target: "https://legacy-api:3000"
    rewrite: "/api$1"
    changeOrigin: true
    headers:
      X-Legacy: "true"
```

### Development with Self-Signed Certs

```yaml
name: "@buntime/plugin-proxy"
enabled: true
rules:
  - name: "Local Backend"
    pattern: "^/api(/.*)?$"
    target: "https://localhost:3443"
    rewrite: "/api$1"
    changeOrigin: true
    secure: false  # Allow self-signed certs
```

## Validation

### Verify Rules Are Loaded

```bash
# List all rules
curl http://localhost:8000/redirects/api/rules | jq .

# Check for specific rule
curl -s http://localhost:8000/redirects/api/rules | jq '.[] | select(.name == "API Gateway")'
```

### Test Pattern Matching

```bash
# Request should be proxied
curl -v http://localhost:8000/api/users
# Look for proxied response headers

# Request should NOT be proxied (no matching rule)
curl -v http://localhost:8000/unknown/path
# Should return normal Buntime response
```

### Test WebSocket Proxy

```bash
# Using websocat (install: cargo install websocat)
websocat ws://localhost:8000/ws/chat

# Or using wscat (install: npm install -g wscat)
wscat -c ws://localhost:8000/ws/chat
```

### Verify Environment Variables

```bash
# Check that env vars are resolved in targets
curl -s http://localhost:8000/redirects/api/rules | jq '.[].target'
# Should show resolved URLs, not ${ENV_VAR} placeholders
```

## Troubleshooting

### Rule Not Matching

1. Check pattern syntax: test the regex against the pathname
2. Verify rule order: earlier rules take precedence
3. Check that the plugin is enabled: `enabled: true`

### Target Connection Failed

1. Verify target is reachable: `curl <target-url>`
2. Check environment variables are set: `echo $BACKEND_URL`
3. For HTTPS with self-signed certs, set `secure: false`

### Dynamic Rules Not Persisting

1. Verify `plugin-keyval` is enabled and working
2. Check KeyVal database connectivity
3. Look for error logs from the proxy plugin

## Next Steps

- [API Reference](../api-reference.md) - Rule CRUD endpoints
- [Overview](../concepts/overview.md) - Architecture and request flow
- [Proxy Rules](../concepts/proxy-rules.md) - Pattern matching deep dive
- [WebSocket Proxying](../concepts/websocket-proxying.md) - WebSocket support
