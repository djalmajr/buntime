# CORS

Cross-Origin Resource Sharing configuration to control access from different origins.

## What is CORS?

CORS (Cross-Origin Resource Sharing) is a browser security mechanism that controls which sites can make requests to your API.

### Problem: Same-Origin Policy

By default, browsers block requests between different origins:

```
https://app.example.com (origin A)
   ↓ blocked ↓
https://api.example.com (origin B)
```

**Different origin if:**
- Different protocol: `http://` vs `https://`
- Different domain: `example.com` vs `api.com`
- Different port: `:8000` vs `:3000`

### Solution: CORS Headers

The server sends special headers allowing access:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Credentials: true
```

## Configuration

### Via manifest.yaml

```yaml
cors:
  origin: "*"
  methods:
    - GET
    - POST
    - PUT
    - DELETE
  credentials: false
  maxAge: 86400
  preflight: true
```

### Via Environment Variables

```bash
GATEWAY_CORS_ORIGIN="*"
GATEWAY_CORS_CREDENTIALS=false
```

## Configuration Options

### origin

Origins allowed to make requests.

- **Type:** `string | string[]`
- **Default:** `"*"`

**Examples:**

#### Allow All Origins

```yaml
cors:
  origin: "*"
```

**Generated header:**
```http
Access-Control-Allow-Origin: *
```

#### Specific Origin

```yaml
cors:
  origin: "https://app.example.com"
```

#### Multiple Origins

```yaml
cors:
  origin:
    - "https://app.example.com"
    - "https://admin.example.com"
    - "http://localhost:3000"
```

**Implementation:** The plugin checks the request `Origin` header and returns the matching value if allowed.

### methods

Allowed HTTP methods.

- **Type:** `string[]`
- **Default:** `["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]`

```yaml
cors:
  methods:
    - GET
    - POST
```

**Generated header:**
```http
Access-Control-Allow-Methods: GET, POST
```

### allowedHeaders

Request headers allowed in addition to simple headers.

- **Type:** `string[]`
- **Default:** `undefined`

**Simple headers (always allowed):**
- `Accept`
- `Accept-Language`
- `Content-Language`
- `Content-Type` (specific values)

**Custom headers:**
```yaml
cors:
  allowedHeaders:
    - X-Custom-Header
    - X-Api-Key
```

**Generated header:**
```http
Access-Control-Allow-Headers: X-Custom-Header, X-Api-Key
```

### exposedHeaders

Response headers that JavaScript can access.

- **Type:** `string[]`
- **Default:** `undefined`

**Simple headers (always exposed):**
- `Cache-Control`
- `Content-Language`
- `Content-Type`
- `Expires`
- `Last-Modified`
- `Pragma`

**Custom headers:**
```yaml
cors:
  exposedHeaders:
    - X-RateLimit-Remaining
    - X-RateLimit-Reset
    - X-Request-Id
```

**Generated header:**
```http
Access-Control-Expose-Headers: X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id
```

### credentials

Allow cookies and authentication headers.

- **Type:** `boolean`
- **Default:** `false`

```yaml
cors:
  credentials: true
```

**Generated header:**
```http
Access-Control-Allow-Credentials: true
```

**⚠️ Important:** If `credentials: true`, `origin` **MUST NOT** be `"*"`. It must be a specific origin.

**Correct:**
```yaml
cors:
  origin: "https://app.example.com"
  credentials: true
```

**Incorrect:**
```yaml
cors:
  origin: "*"
  credentials: true  # ❌ Browser rejects
```

### maxAge

Preflight cache time (seconds).

- **Type:** `number`
- **Default:** `86400` (24 hours)

```yaml
cors:
  maxAge: 3600  # 1 hour
```

**Generated header:**
```http
Access-Control-Max-Age: 3600
```

### preflight

Automatically respond to OPTIONS requests.

- **Type:** `boolean`
- **Default:** `true`

```yaml
cors:
  preflight: true
```

When `true`, OPTIONS requests are automatically responded to with CORS headers.

## Preflight Requests

### What is Preflight?

The browser sends an OPTIONS request before the actual request to verify permissions.

**Example:**

1. **Preflight (automatic by browser):**
```http
OPTIONS /api/users HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type, X-Api-Key
```

2. **Server response:**
```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, X-Api-Key
Access-Control-Max-Age: 86400
```

3. **Actual request (sent by browser after preflight OK):**
```http
POST /api/users HTTP/1.1
Origin: https://app.example.com
Content-Type: application/json
X-Api-Key: abc123

{"name": "John"}
```

### When is Preflight Triggered?

**Simple request (no preflight):**
- Methods: `GET`, `HEAD`, `POST`
- Simple headers only
- Content-Type: `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`

**Complex request (with preflight):**
- Methods: `PUT`, `DELETE`, `PATCH`
- Custom headers: `X-Api-Key`, `Authorization`
- Content-Type: `application/json`

## Configuration Examples

### Local Development

Allow all:

```yaml
cors:
  origin: "*"
  credentials: false
  methods:
    - GET
    - POST
    - PUT
    - DELETE
    - PATCH
```

### Production (SPA + API)

Specific origin with credentials:

```yaml
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
  maxAge: 86400
```

### Multi-Tenant

Multiple origins:

```yaml
cors:
  origin:
    - "https://tenant1.example.com"
    - "https://tenant2.example.com"
    - "https://tenant3.example.com"
  credentials: true
```

### Public API

No credentials, all origins:

```yaml
cors:
  origin: "*"
  credentials: false
  methods:
    - GET
    - POST
```

## Internal Implementation

### Preflight Handler

```typescript
function handlePreflight(req: Request, config: CorsConfig): Response | null {
  if (req.method !== "OPTIONS") return null;
  if (!config.preflight) return null;

  const headers = new Headers();

  // Origin
  const origin = req.headers.get("Origin");
  if (isOriginAllowed(origin, config.origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  // Methods
  if (config.methods) {
    headers.set("Access-Control-Allow-Methods", config.methods.join(", "));
  }

  // Headers
  const requestHeaders = req.headers.get("Access-Control-Request-Headers");
  if (requestHeaders) {
    headers.set("Access-Control-Allow-Headers", requestHeaders);
  }

  // Credentials
  if (config.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  // MaxAge
  if (config.maxAge) {
    headers.set("Access-Control-Max-Age", config.maxAge.toString());
  }

  return new Response(null, { status: 204, headers });
}
```

### Response Headers

```typescript
function addCorsHeaders(res: Response, config: CorsConfig): Response {
  const headers = new Headers(res.headers);

  if (config.origin === "*") {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  if (config.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  if (config.exposedHeaders?.length) {
    headers.set("Access-Control-Expose-Headers", config.exposedHeaders.join(", "));
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
```

## Debugging

### Verify Headers

```bash
# Preflight
curl -X OPTIONS http://localhost:8000/api/users \
  -H "Origin: https://app.example.com" \
  -H "Access-Control-Request-Method: POST" \
  -v

# Expected response
< HTTP/1.1 204 No Content
< Access-Control-Allow-Origin: https://app.example.com
< Access-Control-Allow-Methods: GET, POST, PUT, DELETE
< Access-Control-Max-Age: 86400
```

### Logs

```
[gateway] CORS enabled: origin="*"
```

## Common Errors

### 1. Origin Blocked

**Browser error:**
```
Access to fetch at 'https://api.example.com/users' from origin 'https://app.example.com'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.
```

**Solution:**
```yaml
cors:
  origin: "https://app.example.com"
```

### 2. Credentials with Wildcard

**Browser error:**
```
The value of the 'Access-Control-Allow-Origin' header in the response must not be
the wildcard '*' when the request's credentials mode is 'include'.
```

**Solution:**
```yaml
cors:
  origin: "https://app.example.com"  # Specific, not "*"
  credentials: true
```

### 3. Custom Header Blocked

**Browser error:**
```
Request header field X-Api-Key is not allowed by Access-Control-Allow-Headers
in preflight response.
```

**Solution:**
```yaml
cors:
  allowedHeaders:
    - X-Api-Key
```

## Next Steps

- [Rate Limiting](rate-limiting.md) - Rate limiting
- [Shell Routing](shell-routing.md) - Micro-frontend
- [Configuration](../guides/configuration.md) - Complete reference
