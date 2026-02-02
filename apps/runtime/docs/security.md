# Security

This document describes the security measures implemented in Buntime.

## CSRF Protection

The runtime implements CSRF (Cross-Site Request Forgery) protection for state-changing API requests.

### Protected Methods

CSRF validation is applied to:
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

### Validation Rules

1. **Origin Header Required**: State-changing requests must include an `Origin` header
2. **Origin Must Match Host**: The `Origin` header must match the `Host` header
3. **No Credentials in Origin**: URLs with `user:pass@host` format are blocked
4. **Protocol Validation**: Only `http:` and `https:` protocols are allowed

### Bypassing CSRF

CSRF validation can be bypassed in these cases:

| Method | Description |
|--------|-------------|
| `X-Buntime-Internal: true` | Internal requests (worker-to-runtime) |
| `GET`, `HEAD`, `OPTIONS` | Non-state-changing methods |

### Error Responses

When CSRF validation fails:

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain

Forbidden - Origin required
```

or

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain

Forbidden
```

## Request ID Correlation

The runtime uses request IDs for tracing requests across components.

### Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-Request-Id` | Request | Correlation ID provided by client (optional) |
| `X-Request-Id` | Response | Correlation ID (auto-generated if not provided) |

### Generation

If the client doesn't provide a `X-Request-Id` header, the runtime generates one using `crypto.randomUUID()`.

### Usage

Request IDs are included in:
- Log entries
- Error responses
- Worker requests
- Plugin hook context

### Example

```bash
# Client provides request ID
curl -H "X-Request-Id: abc-123" http://localhost:8000/api/health

# Response includes the same ID
HTTP/1.1 200 OK
X-Request-Id: abc-123
```

## Reserved Paths

Certain paths are reserved by the runtime and cannot be used by plugins or apps.

### Reserved Path List

| Path | Purpose |
|------|---------|
| `/api` | Runtime API routes |
| `/health` | Health check endpoints |
| `/.well-known` | Standard well-known URIs (ACME, security.txt, etc.) |

### Enforcement

If a plugin tries to use a reserved path as its `base`, the loader throws an error:

```
Error: Plugin "my-plugin" cannot use reserved path "/api". Reserved paths: /api, /health, /.well-known
```

## Path Validation

### Plugin Base Path

Plugin base paths must match the pattern `/[a-zA-Z0-9_-]+`:

- Must start with `/`
- Only alphanumeric characters, underscores, and hyphens
- Single path segment (no nested paths)

Invalid examples:
- `/plugins/my-plugin` (nested path)
- `/my plugin` (contains space)
- `my-plugin` (no leading slash)

### Entrypoint Path Traversal

Worker entrypoints are validated to prevent path traversal attacks:

```typescript
const resolvedEntry = resolve(APP_DIR, ENTRYPOINT);
if (!resolvedEntry.startsWith(APP_DIR)) {
  throw new Error(`Security: Entrypoint escapes app directory`);
}
```

This prevents attacks like `../../etc/passwd` or `/absolute/path/outside/app`.

## Environment Variable Security

### Sensitive Variable Filtering

When passing environment variables from `manifest.yaml` to workers, sensitive variables are automatically blocked.

**Blocked Patterns:**

| Pattern | Examples |
|---------|----------|
| `^(DATABASE\|DB)_` | `DATABASE_URL`, `DB_HOST` |
| `^(API\|AUTH\|SECRET\|PRIVATE)_?KEY` | `API_KEY`, `SECRET_KEY` |
| `_TOKEN$` | `ACCESS_TOKEN`, `GITHUB_TOKEN` |
| `_SECRET$` | `JWT_SECRET`, `CLIENT_SECRET` |
| `_PASSWORD$` | `DB_PASSWORD`, `ADMIN_PASSWORD` |
| `^AWS_` | `AWS_ACCESS_KEY_ID` |
| `^GITHUB_` | `GITHUB_TOKEN` |
| `^OPENAI_` | `OPENAI_API_KEY` |
| `^ANTHROPIC_` | `ANTHROPIC_API_KEY` |
| `^STRIPE_` | `STRIPE_SECRET_KEY` |

**Warning Log:**

When sensitive variables are blocked, a warning is logged:

```
WRN Blocked sensitive env vars from worker {"blocked":["DATABASE_PASSWORD","API_KEY"]}
```

### Worker Environment Isolation

Workers receive a controlled set of environment variables:

| Variable | Source |
|----------|--------|
| `APP_DIR` | Runtime (absolute path) |
| `ENTRYPOINT` | Runtime (full path) |
| `NODE_ENV` | Inherited |
| `RUNTIME_API_URL` | Runtime (internal URL) |
| `RUNTIME_LOG_LEVEL` | Inherited |
| `RUNTIME_PLUGIN_DIRS` | Inherited |
| `RUNTIME_WORKER_DIRS` | Inherited |
| `WORKER_CONFIG` | Runtime (JSON) |
| `WORKER_ID` | Runtime (UUID) |
| Custom from `manifest.env` | Filtered |

## Auto-Install Security

When `autoInstall: true` is configured, the runtime uses security flags:

```bash
bun install --frozen-lockfile --ignore-scripts
```

| Flag | Purpose |
|------|---------|
| `--frozen-lockfile` | Prevents lockfile modification (reproducibility) |
| `--ignore-scripts` | Doesn't execute postinstall scripts (prevents malicious code) |

## Response Header Limits

To prevent memory exhaustion from malicious responses, the wrapper applies limits:

| Limit | Value | Description |
|-------|-------|-------------|
| `MAX_COUNT` | 100 | Maximum number of headers |
| `MAX_TOTAL_SIZE` | 64 KB | Maximum total size of all headers |
| `MAX_VALUE_SIZE` | 8 KB | Maximum size per header value |

Headers exceeding these limits are truncated or ignored.

## HTML Injection Prevention

When injecting `<base href>` into HTML responses, values are escaped to prevent XSS:

```typescript
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\");
}
```

## Worker Collision Prevention

The pool prevents duplicate app registrations from different directories:

```
Error: Worker collision: "my-app@1.0.0" already registered from "/apps/my-app", cannot register from "/other/my-app"
```

This prevents:
- Accidental duplicate deployments
- Potential hijacking of app routes

## Request Body Size Limits

The runtime enforces body size limits:

| Limit | Value | Configurable |
|-------|-------|--------------|
| Default | 10 MB | Per-worker via `maxBodySize` |
| Maximum | 100 MB | Global ceiling |

Requests exceeding the limit receive:

```
HTTP/1.1 413 Payload Too Large
```

## Best Practices

### For Plugin Developers

1. **Don't hardcode secrets** - Use environment variables with `${VAR}` interpolation
2. **Validate input** - Always validate user input in API handlers
3. **Use publicRoutes carefully** - Only expose truly public endpoints
4. **Implement rate limiting** - Use the gateway plugin for rate limiting

### For Deployment

1. **Use HTTPS** - Always use HTTPS in production (via reverse proxy)
2. **Set secure headers** - Configure CSP, HSTS, etc. in your reverse proxy
3. **Rotate API keys** - Regularly rotate CLI API keys
4. **Monitor logs** - Watch for security warnings in logs
5. **Keep dependencies updated** - Regularly update Bun and dependencies

### For Workers/Apps

1. **Don't store secrets in code** - Use `manifest.env` or plugin services
2. **Validate request origins** - For sensitive operations, validate the source
3. **Use parameterized queries** - Prevent SQL injection
4. **Escape output** - Prevent XSS in HTML responses
