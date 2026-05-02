---
title: "Security"
audience: ops
sources:
  - apps/runtime/docs/security.md
updated: 2026-05-02
tags: [security, csrf, api-keys, csp]
status: stable
---

# Security

> Overview of the security protections applied by the Buntime runtime: CSRF, request ID, reserved paths, path validation, sensitive env var filtering in workers, secure auto-install, body/header limits, and recommended deploy practices.

For `/data` directories, env vars, and manifest validation at startup, see [Environments](./environments.md). For log correlation with `X-Request-Id`, see [Logging](./logging.md).

## CSRF protection

The runtime enforces CSRF (Cross-Site Request Forgery) validation on state-mutating methods.

### Protected methods

`POST`, `PUT`, `PATCH`, `DELETE`.

### Validation rules

1. **Origin required** — protected methods must include an `Origin` header
2. **Origin = Host** — `Origin` must match `Host`
3. **No embedded credentials** — URLs with `user:pass@host` are blocked
4. **Valid protocol** — only `http:` and `https:`

### Bypass

| Case | When |
|------|------|
| Header `X-Buntime-Internal: true` | Worker → runtime (internal) |
| `GET`, `HEAD`, `OPTIONS` | Non-mutating methods |

### Errors

```
HTTP/1.1 403 Forbidden
Content-Type: text/plain

Forbidden - Origin required
```

or simply `Forbidden` when the origin does not match.

## Request ID correlation

Every request carries an `X-Request-Id` for tracing.

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-Request-Id` | Request | Client may provide (optional) |
| `X-Request-Id` | Response | Always present (auto-generated via `crypto.randomUUID()` if absent) |

The ID propagates through:

- Logs (all levels)
- Errors
- Workers (via internal header)
- Plugin hooks (`PluginContext.requestId`)

Usage details in logs: [Logging](./logging.md#request-id-correlation).

## Reserved paths

Plugins cannot use the following as their `base`:

| Path | Reason |
|------|--------|
| `/api` | Runtime internal routes |
| `/health` | Health checks |
| `/.well-known` | Standardized URIs (ACME, security.txt, etc.) |

Attempting to register a plugin with `base: /api` aborts startup:

```
Error: Plugin "my-plugin" cannot use reserved path "/api". Reserved paths: /api, /health, /.well-known
```

> When `RUNTIME_API_PREFIX` is set (e.g., `/_`), internal routes become `/_/api/*` but the reserved paths remain reserved at the root.

## Path validation

### Plugin base path

Must match `^/[a-zA-Z0-9_-]+$`:

- Starts with `/`
- Only alphanumeric, underscore, and hyphen
- Single segment (no nested `/`)

| Invalid | Why |
|---------|-----|
| `/plugins/my-plugin` | Nested path |
| `/my plugin` | Space |
| `my-plugin` | No leading slash |

### Entrypoint path traversal

Worker entrypoints are resolved against `APP_DIR` to prevent traversal:

```typescript
const resolvedEntry = resolve(APP_DIR, ENTRYPOINT);
if (!resolvedEntry.startsWith(APP_DIR)) {
  throw new Error("Security: Entrypoint escapes app directory");
}
```

Blocks `../../etc/passwd`, `/absolute/path/outside/app`, etc.

### Worker collision

The pool prevents duplicate registrations of the same `app@version` from different directories:

```
Error: Worker collision: "my-app@1.0.0" already registered from "/apps/my-app", cannot register from "/other/my-app"
```

Prevents accidental duplicate deploys and potential route hijacking.

## Sensitive env var filtering

When `manifest.yaml` declares `env:` to pass variables to the worker, "sensitive" variables are automatically blocked.

### Blocked patterns

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

When a variable is blocked, a `WARN` log is generated:

```
WRN Blocked sensitive env vars from worker {"blocked":["DATABASE_PASSWORD","API_KEY"]}
```

### Env vars inherited by the worker

The wrapper passes a controlled set:

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
| Custom from `manifest.env` | Filtered by the patterns above |

To pass secrets to a worker securely, use plugins (database, keyval) with `${VAR}` interpolation in the plugin manifest — not `manifest.env` on the worker.

## Secure auto-install

Workers with `autoInstall: true` in `manifest.yaml` run the install with strict flags:

```bash
bun install --frozen-lockfile --ignore-scripts
```

| Flag | Purpose |
|------|---------|
| `--frozen-lockfile` | Does not modify the lockfile (reproducibility) |
| `--ignore-scripts` | Does not run `postinstall` (prevents malicious code) |

## Body and header limits

### Request body

| Limit | Value | Configurable |
|-------|-------|--------------|
| Default | 10 MB | Per worker via `maxBodySize` in the manifest |
| Maximum | 100 MB | Global ceiling (workers that exceed it are capped, generates `WARN`) |

Exceeded? `413 Payload Too Large`.

> In nginx ingress, remember to set `nginx.ingress.kubernetes.io/proxy-body-size` (or `ingress.maxBodySize` in the chart, default `100m`) to align with the runtime ceiling.

### Response headers (from worker to client)

Applied in the wrapper to prevent memory exhaustion:

| Limit | Value | Description |
|-------|-------|-------------|
| `MAX_COUNT` | 100 | Maximum number of headers |
| `MAX_TOTAL_SIZE` | 64 KB | Total size of all headers |
| `MAX_VALUE_SIZE` | 8 KB | Maximum size per value |

Headers exceeding the limit are truncated or ignored.

## HTML injection prevention

When the runtime injects `<base href>` into HTML responses (for SPAs under a subpath), the value is escaped:

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

Prevents XSS via a manipulated `X-Forwarded-Prefix` header or base path.

## Best practices

### For deploy

1. **HTTPS always** — TLS terminated at the Ingress (cert-manager + Let's Encrypt) or at the Route (OpenShift)
2. **Secure headers** — configure CSP, HSTS, X-Frame-Options in the reverse proxy/ingress
3. **Rotate API keys** — `buntime.masterKey` and CLI/TUI tokens
4. **Monitor logs** — specific `WARN`/`ERROR` entries: sensitive env vars blocked, body capped, CSRF failed
5. **Keep Bun and dependencies up to date** — bump Bun and core plugins via `bump-version.ts`
6. **LibSQL token** — in production, always use `DATABASE_LIBSQL_AUTH_TOKEN` (not `SQLD_DISABLE_AUTH=true`)

### For plugin authors

1. **Do not hardcode secrets** — use `${VAR}` interpolation in the manifest
2. **Validate input** — always use Zod or manual validation in public handlers
3. **Be careful with `publicRoutes`** — only expose routes that truly need to bypass auth
4. **Rate limiting** — use plugin-gateway instead of rolling your own

### For worker/app authors

1. **Do not store secrets in code** — use `manifest.env` (with automatic filtering) or plugins
2. **Validate origins** — for sensitive actions, check `Referer`/`Origin`
3. **Parameterized queries** — prevent SQL injection when using `@buntime/database`
4. **Escape output** — prevent XSS in HTML responses

## Cross-refs

- **`/data` directories and lookup order**: [Environments](./environments.md#data-directories)
- **WARN/ERROR logs**: [Logging](./logging.md)
- **Manifest validation at startup**: [Environments](./environments.md#startup-validation)
- **CLI/TUI master key**: [Helm charts](./helm-charts.md#buntime-block) (`buntime.masterKey`)
