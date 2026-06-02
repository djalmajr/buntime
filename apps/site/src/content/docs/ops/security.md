---
title: Security
description: Security protections in the Buntime runtime — CSRF, request IDs, reserved paths, path validation, sensitive env filtering, secure auto-install, body/header limits, and namespaces.
sidebar:
  order: 3
---

Overview of the security protections applied by the Buntime runtime: CSRF, request ID, reserved paths, path validation, sensitive env var filtering in workers, secure auto-install, body/header limits, and recommended deploy practices.

For `/data` directories, env vars, and manifest validation at startup, see [Environments](/ops/environment/). For log correlation with `X-Request-Id`, see [Logging](/ops/logging/).

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

Usage details in logs: [Logging](/ops/logging/).

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

:::note
When `RUNTIME_API_PREFIX` is set (e.g., `/_`), internal routes become `/_/api/*` but the reserved paths remain reserved at the root.
:::

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

To pass secrets to a worker securely, use plugins (turso, keyval) with `${VAR}` interpolation in the plugin manifest — not `manifest.env` on the worker.

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

:::note
In nginx ingress, remember to set `nginx.ingress.kubernetes.io/proxy-body-size` (or `ingress.maxBodySize` in the chart, default `100m`) to align with the runtime ceiling.
:::

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

## Namespace-scoped access control

API keys carry a **`namespaces`** list alongside their role/permissions. A namespace is the npm-style `@scope` of a worker/plugin name (see [worker-pool namespaces](/concepts/worker-pool/)). It gates *which* `@scope` units a key may see and manage, independent of the permission set — a key can hold `workers:install` yet still be denied a deploy into a namespace it doesn't own.

### Model

| `namespaces` value | Meaning |
|---|---|
| `["*"]` (default) | Full access — every namespace **and** unscoped units. This is the value for legacy keys and the runtime root key. |
| `["@example", "@example-org"]` | Only these scopes. **Cannot** touch unscoped units (an unscoped resource requires `*`). |

- Stored as a JSON column on `api_keys`; surfaced on `ApiKeyInfo` / `ApiKeyPrincipal` and validated against `/^@[a-z0-9][a-z0-9._-]*$/i` (`normalizeNamespaces`).
- The runtime **root key** and any key with role behaviour `isRoot` bypass the namespace gate entirely (`principalCanAccessNamespace` short-circuits on `isRoot`).

### Enforcement points

The namespace of a target is derived per surface, then checked with `principalCanAccessNamespace(principal, ns)`:

| Surface | Where the namespace comes from | Behaviour |
|---|---|---|
| `/api/workers/:scope/:name/...`, `/api/plugins/:name` (enable/disable/delete) | URL path (`:scope`, decoded plugin name) | API middleware (`app.ts`) returns `403 NAMESPACE_DENIED` before the route runs. |
| `/api/{workers,plugins}/files/*` (the FileBrowser: list/upload/mkdir/delete/rename/move/download) | the `path` (query **or** request body) | `fs.ts` self-enforces — it cannot be gated in the middleware because the path arrives in the body. Listing a forbidden `@scope` 403s; mount-level listings are **filtered** so siblings the key can't access are hidden. |
| `POST /api/{workers,plugins}/upload` | the archive's `package.json` name (known only after extraction) | the upload handler 403s after `readPackageInfo` if the package's `@scope` is out of bounds. |
| `GET /api/workers`, `GET /api/plugins`, `GET /api/plugins/loaded` | each item's name | results are **filtered** to the key's namespaces. |

The principal is published on the Hono context (`c.set("principal", …)`) by the API gate and read by the sub-routers (`c.get("principal")`); the `ContextVariableMap` augmentation lives in `apps/runtime/src/libs/hono-context.ts`. Hono propagates context variables across `app.route()` mounts, so a single set in the gate reaches every handler.

### cpanel

The key-create Sheet (`/cpanel/keys`) has a **Namespaces** field (default `*`, space/comma-separated); the keys table shows each key's namespaces; the session principal exposes its own list. A restricted key only sees its namespaces' workers/plugins and the FileBrowser hides folders it cannot access.

:::note
**Future (not built):** per-environment **plugin activation** (enable a plugin only under e.g. `@production`) is a separate, wanted capability — plugins still load globally (`manifest.enabled` is all-or-nothing). Likely expressed via vhosts. Tracked in [worker-pool](/concepts/worker-pool/).
:::

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
3. **Parameterized queries** — prevent SQL injection when using the Turso/LibSQL integration
4. **Escape output** — prevent XSS in HTML responses

## Cross-refs

- **`/data` directories and lookup order**: [Environments](/ops/environment/)
- **WARN/ERROR logs**: [Logging](/ops/logging/)
- **Manifest validation at startup**: [Environments](/ops/environment/)
- **Runtime root key**: [Helm charts](/ops/helm-kubernetes/) (`buntime.rootKey`)
