# Configuration

Complete reference for all plugin-gateway configuration options.

## Configuration Methods

### 1. manifest.yaml

Static plugin configuration:

```yaml
# plugins/plugin-gateway/manifest.yaml
name: "@buntime/plugin-gateway"
base: "/gateway"
enabled: true

shellDir: /data/apps/example-spa
shellExcludes: cpanel,admin

rateLimit:
  requests: 100
  window: "1m"
  keyBy: ip
  excludePaths:
    - "/health"
    - "/_/api/health"

cors:
  origin: "*"
  credentials: false
  methods:
    - GET
    - POST
    - PUT
    - DELETE
```

### 2. Environment Variables

Override manifest values:

```bash
# Shell
GATEWAY_SHELL_DIR=/data/apps/example-spa
GATEWAY_SHELL_EXCLUDES=cpanel,admin,legacy

# Rate Limiting
GATEWAY_RATE_LIMIT_REQUESTS=100
GATEWAY_RATE_LIMIT_WINDOW=1m

# CORS
GATEWAY_CORS_ORIGIN=https://app.example.com
GATEWAY_CORS_CREDENTIALS=false
```

### 3. Cookie (Shell Bypass Only)

Users can add bypasses via cookie:

```javascript
document.cookie = "GATEWAY_SHELL_EXCLUDES=deployments; path=/";
```

## Configuration Options

### Shell (Micro-Frontend)

#### shellDir

Absolute path to shell application.

- **Type:** `string`
- **Default:** `""` (disabled)
- **Env:** `GATEWAY_SHELL_DIR`

**Example:**
```yaml
shellDir: /data/apps/example-spa
```

**Requirements:**
- Path must exist
- Must have valid `manifest.yaml`
- Must have entrypoint defined

#### shellExcludes

Basenames that bypass the shell (comma-separated).

- **Type:** `string`
- **Default:** `"cpanel"`
- **Env:** `GATEWAY_SHELL_EXCLUDES`
- **Cookie:** `GATEWAY_SHELL_EXCLUDES`

**Example:**
```yaml
shellExcludes: cpanel,admin,legacy,reports
```

**Rules:**
- Only alphanumeric characters, `-`, `_`
- Comma-separated
- Cookie values are merged with env

### Rate Limiting

#### rateLimit.requests

Maximum token bucket capacity.

- **Type:** `number`
- **Default:** `100`
- **Min:** `1`
- **Max:** `10000`
- **Env:** `GATEWAY_RATE_LIMIT_REQUESTS`

**Example:**
```yaml
rateLimit:
  requests: 1000
```

#### rateLimit.window

Time window for refill.

- **Type:** `string`
- **Default:** `"1m"`
- **Values:** `"30s"`, `"1m"`, `"5m"`, `"15m"`, `"1h"`
- **Env:** `GATEWAY_RATE_LIMIT_WINDOW`

**Example:**
```yaml
rateLimit:
  window: "1h"
```

#### rateLimit.keyBy

Client identification strategy.

- **Type:** `"ip" | "user" | Function`
- **Default:** `"ip"`

**Options:**

##### ip (default)

Uses client IP:

```yaml
rateLimit:
  keyBy: ip
```

Headers checked (in order):
1. `X-Forwarded-For` (first IP)
2. `X-Real-IP`
3. `"unknown"` (fallback)

##### user

Uses `X-Identity` header (requires plugin-authn):

```yaml
rateLimit:
  keyBy: user
```

Expected header:
```json
X-Identity: {"sub": "user-id-123"}
```

Generated key: `user:user-id-123`

##### Function (code)

Custom via code:

```typescript
// plugin.ts
export default gatewayPlugin({
  rateLimit: {
    keyBy: (req: Request) => {
      const tenant = req.headers.get("X-Tenant-Id");
      return `tenant:${tenant}`;
    },
  },
});
```

#### rateLimit.excludePaths

Paths that bypass rate limiting (regex patterns).

- **Type:** `string[]`
- **Default:** `[]`

**Example:**
```yaml
rateLimit:
  excludePaths:
    - "/health"
    - "/_/api/health"
    - "/api/public/.*"
    - ".*/webhook$"
```

**Pattern matching:**
- Standard JavaScript regex
- Tested against full pathname

### CORS

#### cors.origin

Allowed origins.

- **Type:** `string | string[]`
- **Default:** `"*"`
- **Env:** `GATEWAY_CORS_ORIGIN`

**Examples:**

Allow all:
```yaml
cors:
  origin: "*"
```

Specific origin:
```yaml
cors:
  origin: "https://app.example.com"
```

Multiple origins:
```yaml
cors:
  origin:
    - "https://app.example.com"
    - "https://admin.example.com"
    - "http://localhost:3000"
```

Via env (multiple):
```bash
GATEWAY_CORS_ORIGIN=https://app.example.com,https://admin.example.com
```

#### cors.credentials

Allow cookies and authentication headers.

- **Type:** `boolean`
- **Default:** `false`
- **Env:** `GATEWAY_CORS_CREDENTIALS`

**Example:**
```yaml
cors:
  credentials: true
  origin: "https://app.example.com"  # Cannot be "*"
```

**⚠️ Important:** If `credentials: true`, `origin` must be specific.

#### cors.methods

Allowed HTTP methods.

- **Type:** `string[]`
- **Default:** `["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]`

**Example:**
```yaml
cors:
  methods:
    - GET
    - POST
```

#### cors.allowedHeaders

Allowed request headers (in addition to simple headers).

- **Type:** `string[]`
- **Default:** `undefined`

**Simple headers (always allowed):**
- Accept
- Accept-Language
- Content-Language
- Content-Type (specific values)

**Custom headers:**
```yaml
cors:
  allowedHeaders:
    - X-Custom-Header
    - X-Api-Key
    - Authorization
```

#### cors.exposedHeaders

Response headers exposed to JavaScript.

- **Type:** `string[]`
- **Default:** `undefined`

**Simple headers (always exposed):**
- Cache-Control
- Content-Language
- Content-Type
- Expires
- Last-Modified
- Pragma

**Custom headers:**
```yaml
cors:
  exposedHeaders:
    - X-RateLimit-Remaining
    - X-RateLimit-Reset
    - X-Request-Id
```

#### cors.maxAge

Preflight cache (seconds).

- **Type:** `number`
- **Default:** `86400` (24 hours)

**Example:**
```yaml
cors:
  maxAge: 3600  # 1 hour
```

#### cors.preflight

Automatically respond to OPTIONS.

- **Type:** `boolean`
- **Default:** `true`

**Example:**
```yaml
cors:
  preflight: true
```

### Cache (Disabled)

Response cache is currently disabled in code. Configuration exists but has no effect.

## Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `GATEWAY_SHELL_DIR` | string | `""` | Path to shell app |
| `GATEWAY_SHELL_EXCLUDES` | string | `"cpanel"` | Basenames that bypass shell |
| `GATEWAY_RATE_LIMIT_REQUESTS` | number | `100` | Max requests per window |
| `GATEWAY_RATE_LIMIT_WINDOW` | string | `"1m"` | Time window |
| `GATEWAY_CORS_ORIGIN` | string | `"*"` | Allowed origins |
| `GATEWAY_CORS_CREDENTIALS` | boolean | `false` | Allow credentials |

## Complete Examples

### Local Development

```yaml
# manifest.yaml
cors:
  origin: "*"
  credentials: false
  methods:
    - GET
    - POST
    - PUT
    - DELETE

rateLimit:
  requests: 1000
  window: "1m"
  keyBy: ip
  excludePaths:
    - "/health"
```

```bash
# .env
GATEWAY_SHELL_DIR=/path/to/local/shell
GATEWAY_SHELL_EXCLUDES=cpanel
```

### Production - Single SPA

```yaml
# manifest.yaml
shellDir: /data/apps/example-spa
shellExcludes: cpanel,admin

cors:
  origin: "https://app.example.com"
  credentials: true
  methods:
    - GET
    - POST
    - PUT
    - DELETE
  exposedHeaders:
    - X-Request-Id
    - X-RateLimit-Remaining

rateLimit:
  requests: 60
  window: "1m"
  keyBy: user
  excludePaths:
    - "/health"
    - "/_/api/health"
```

### Production - Multi-Tenant

```yaml
# manifest.yaml
shellDir: /data/apps/shell
shellExcludes: cpanel,legacy

cors:
  origin:
    - "https://tenant1.example.com"
    - "https://tenant2.example.com"
    - "https://tenant3.example.com"
  credentials: true

rateLimit:
  requests: 5000
  window: "1h"
  keyBy: user
```

### Public API

```yaml
# manifest.yaml
# No shell
cors:
  origin: "*"
  credentials: false

rateLimit:
  requests: 100
  window: "1m"
  keyBy: ip
  excludePaths:
    - "/api/public/.*"
```

## Helm Values

### values.yaml (auto-generated)

```yaml
plugins:
  gateway:
    shellDir: ""
    shellExcludes: "cpanel"
    rateLimit:
      requests: 100
      window: "1m"
    cors:
      origin: "*"
      credentials: false
```

### Override on deploy

```bash
helm upgrade buntime ./charts/buntime \
  --set plugins.gateway.shellDir="/data/apps/example-spa" \
  --set plugins.gateway.rateLimit.requests=1000
```

## Validation

### Rate Limit

```bash
# Test rate limit
for i in {1..105}; do
  curl http://localhost:8000/api/health
done

# Request 101 should return 429
```

### CORS

```bash
# Test preflight
curl -X OPTIONS http://localhost:8000/api/users \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -v

# Verify headers
```

### Shell

```bash
# Normal navigation (should serve shell)
curl http://localhost:8000/deployments \
  -H "Sec-Fetch-Dest: document" \
  -v

# Bypass (should serve app directly)
curl http://localhost:8000/cpanel \
  -H "Sec-Fetch-Dest: document" \
  -v
```

## Next Steps

- [Shell Setup](shell-setup.md) - Micro-frontend setup
- [Rate Limiting](../concepts/rate-limiting.md) - Concepts
- [CORS](../concepts/cors.md) - Concepts
