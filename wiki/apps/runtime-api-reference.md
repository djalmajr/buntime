---
title: "Runtime API Reference"
audience: dev
sources:
  - apps/runtime/docs/api-reference.md
  - apps/runtime/docs/admin-console.md
updated: 2026-05-02
tags: [runtime, api, rest, openapi, admin]
status: stable
---

# Runtime API Reference

Internal REST API for health checks, plugin/app management, admin/auth, and
API key management. Used by the CLI/TUI, the CPanel (`/cpanel/`), and CI
automation.

For the general architecture, see [@buntime/runtime](./runtime.md). For the
pool that executes operations, see [Worker Pool](./worker-pool.md).

## Base URL and Discovery

| Scenario | API Path |
|----------|---------|
| Default | `/api` |
| With `RUNTIME_API_PREFIX="/_"` | `/_/api` |

> [!TIP]
> Clients should read `/.well-known/buntime` and use the `api` field returned
> rather than hardcoding `/api` or `/_/api`. Plugins are **not** affected by
> the prefix — only the internal API is.

```bash
curl https://buntime.home/.well-known/buntime
# { "api": "/_/api", "version": "1.0.0", ... }
```

## Authentication

Three independent layers:

### 1. CSRF (browser)

Applied to state-mutating methods (POST, PUT, PATCH, DELETE) on `/api/*`.
Requires an `Origin` header matching the server host. Bypassed for
`X-Buntime-Internal: true` (worker → runtime).

### 2. Root Key (`RUNTIME_ROOT_KEY`)

Bootstrap key. Used to create the first scoped admin/editor keys on a fresh
deploy.

```bash
curl -H "X-API-Key: $ROOT_KEY" ...
# or
curl -H "Authorization: Bearer $ROOT_KEY" ...
```

The root key:

- Bypasses CSRF.
- Bypasses plugin `onRequest` hooks.
- Appears as synthetic principal `root` (with `role=admin`, `isRoot=true`).
- Helm exposes it as `buntime.rootKey` in the Secret.

> Do not expose the root key to the browser. It is for bootstrap only.
> Pre-2026-05-20 this was named `RUNTIME_MASTER_KEY` / `master` principal —
> the rename is breaking; update any external consumer.

### 3. API Keys (created via API)

Keys generated via `POST /api/keys`. Stored as SHA-256 hashes in a **Turso DB**
file at `${RUNTIME_STATE_DIR}/api-keys.db` (Helm: `/data/state/api-keys.db`
on a per-pod RWO PVC).

The store uses `@tursodatabase/database` (local mode) or `@tursodatabase/sync`
(embedded replica mode, when `RUNTIME_AUTH_DB_MODE=sync`), with MVCC journal
enabled. No external dependency for the default local mode. For multi-pod see
[Multi-pod deployment](../ops/multi-pod-deployment.md).

Backend evolution:
- Pre-2026-05-20: JSON file (`api-keys.json`). Migrated to DB on first boot
  and renamed to `*.migrated`.
- 2026-05-20: `bun:sqlite`. Files are binarily SQLite-compatible.
- 2026-05-20 (later): Turso DB. Same `.db` file opens; journal upgrades to
  MVCC on next write. Adds `mode=sync` for embedded replicas in multi-pod.

| Role | Access |
|------|--------|
| `admin` | All permissions |
| `editor` | Install/remove apps and plugins, plugin config, worker ops |
| `viewer` | Read-only (apps, plugins, workers, keys) |
| `custom` | Explicit permissions selected at creation time |

## Endpoints — Overview

| Group | Base path | Purpose |
|-------|-----------|---------|
| Admin | `/api/admin` | Session validation for CPanel admin |
| Health | `/api/health` | Health, readiness, liveness probes |
| Workers | `/api/workers` | List, upload, delete workers (a.k.a. apps) |
| Plugins | `/api/plugins` | List, upload, reload, delete plugins |
| Keys | `/api/keys` | List, create, revoke API keys |
| Docs | `/api/openapi.json`, `/api/docs` | Spec + Scalar UI |

Details per group below.

## Admin Session

Three endpoints govern operator authentication. They accept the credential via:
- `X-API-Key: <key>` header (programmatic clients, CLI)
- `Authorization: Bearer <key>` header (SDKs)
- `buntime_api_key` cookie (issued by `POST /api/admin/session` — used by the cpanel)

Lifetime of the cookie is set by `RUNTIME_CPANEL_SESSION_TTL` (default `24h`, accepts strings like `30m`, `7d`).

### `GET /api/admin/session`

Probe the current session. Returns the principal if any of the three credential channels resolves; otherwise 401.

```bash
# CLI (header)
curl -H "X-API-Key: $KEY" https://buntime.home/_/api/admin/session

# Browser (cookie travels automatically)
fetch("/_/api/admin/session", { credentials: "same-origin" })
```

Response:

```json
{
  "authenticated": true,
  "principal": {
    "id": 1,
    "name": "Admin Console",
    "keyPrefix": "btk_abcd1234",
    "role": "admin",
    "permissions": ["workers:read", "workers:install", "keys:read"]
  }
}
```

The root key returns the synthetic `root` principal (`isRoot: true`, `role: admin`).
The frontend uses `permissions` only to show/hide UI — real authorization
happens in the runtime.

### `POST /api/admin/session`

Exchange an API key for an HttpOnly session cookie. Used by the cpanel login form so that all subsequent same-origin requests (including plugin iframes that cannot inject headers) authenticate via the cookie.

```http
POST /api/admin/session
Content-Type: application/json

{"key": "btk_..."}
```

Responses:
- `200 OK` — body `{ authenticated: true, principal: {...} }`, headers include `Set-Cookie: buntime_api_key=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` (and `Secure` on HTTPS).
- `400 Bad Request` — body or `key` field missing/malformed.
- `401 Unauthorized` — key does not match the root key and is not in the store.

The runtime accepts the `RUNTIME_ROOT_KEY` here exactly like the header path — operators who only have the root key configured can still log in to the cpanel without provisioning a regular API key first.

### `DELETE /api/admin/session`

Clear the session cookie. Idempotent: returns `204 No Content` regardless of whether a cookie was present.

```http
DELETE /api/admin/session
```

Response: `204` with `Set-Cookie: buntime_api_key=; Max-Age=0; Path=/; SameSite=Strict`.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `RUNTIME_ROOT_KEY` | _(unset)_ | Operator bootstrap key. Matches before the store, returns synthetic `root` principal. |
| `RUNTIME_CPANEL_SESSION_TTL` | `24h` | Cookie lifetime, parsed via `parseDurationToMs` (accepts `30m`, `2h`, `7d`, etc.). |

## Health

| Route | Probe | Response |
|-------|-------|----------|
| `GET /api/health` | General | `{ ok, status: "healthy", version }` |
| `GET /api/health/ready` | Kubernetes readiness | `{ ok, status: "ready", version }` |
| `GET /api/health/live` | Kubernetes liveness | `{ ok, status: "live", version }` |

All return 200 when healthy.

```bash
curl https://buntime.home/_/api/health/ready
```

## Workers

> "Workers" here means deployed serverless artifacts that the WorkerPool can
> execute. The runtime treats apps and workers as the same concept — these
> endpoints manage them on the filesystem (workerDirs). Pre-2026-05-19 the
> same surface was published under `/api/apps` and gated by `apps:*`; both
> were retired in favor of the worker vocabulary.

### `GET /api/workers`

Lists workers in `RUNTIME_WORKER_DIRS`. The runtime uses the filesystem only to
discover candidate package roots; the public `name` and `version` come from
package metadata (`manifest.yaml`, `manifest.yml`, or `package.json`). Folders
without package metadata are ignored because they are outside the supported
package format.

```json
[
  {
    "name": "my-worker",
    "path": "/data/apps/my-worker",
    "removable": true,
    "source": "uploaded",
    "versions": ["1.0.0", "1.1.0"]
  },
  {
    "name": "@buntime/cpanel",
    "path": "/data/.apps/cpanel",
    "removable": false,
    "source": "built-in",
    "versions": ["1.0.0"]
  }
]
```

`source` is `built-in` for anything that comes from the Buntime project/image
and `uploaded` for external roots such as `/data/apps`. Only uploaded workers
are removable.

### `POST /api/workers/upload`

Upload via multipart/form-data. Accepts `.tgz`, `.tar.gz`, `.zip`.

**Archive contract** (shared with `/api/plugins/upload` below):

- **Extensions accepted**: `.tgz`, `.tar.gz`, `.zip`. Anything else → `INVALID_FILE_TYPE`.
- **Internal layout**: files either at the archive root, or wrapped in a single
  top-level `package/` folder (npm-pack convention). Tgz auto-strips via
  `tar --strip-components=1`; zip detects + manually unwraps a single `package/`
  folder if present.
- **Metadata source** (read at the effective root, after unwrap):
  - **`manifest.yaml`** (or `manifest.yml`) is preferred. Read keys: `name`, `version`.
  - **`package.json`** is fallback. Same keys.
  - `name` is **required** (from either source). Missing name → 400.
  - `version` is **optional** — defaults to `"latest"` when neither file declares it.
- **Scoped names supported**: `name: "@scope/foo"` parses correctly. See "Install paths" below.

**Install path (workers)** — derived from `name` + `version`:

| `name`              | `version` | Installed at                            |
|---------------------|-----------|------------------------------------------|
| `my-worker`         | `1.0.0`   | `<workerDir>/my-worker/1.0.0/`           |
| `@scope/my-worker`  | `1.0.0`   | `<workerDir>/@scope/my-worker/1.0.0/`    |
| `my-worker`         | (missing) | `<workerDir>/my-worker/latest/`          |

If the install path already exists, the existing folder is removed first, then
the archive contents are moved into place. This is an upsert, not a merge.

`<workerDir>` is the first writable entry in `RUNTIME_WORKER_DIRS` (selected by
`selectInstallDir()`; image-provided dirs starting with `.` are skipped).

```bash
curl -X POST \
  -H "X-API-Key: $KEY" \
  -F "file=@my-worker-1.0.0.tgz" \
  https://buntime.home/_/api/workers/upload
```

Errors: `NO_WORKER_DIRS` (400), `NO_FILE_PROVIDED` (400),
`INVALID_FILE_TYPE` (400), `PATH_TRAVERSAL` (400).

### `POST /api/workers/:scope/:name/:version/{enable,disable}`

Toggle a worker **version** at runtime (no restart). Disabling writes
`enabled: false` to that version's `manifest.yaml` (creating the manifest if
the worker shipped only `package.json`) and clears the worker-config cache. A
disabled version is treated as not-installed — its base path 404s. Use `_` as
scope for unscoped workers.

```bash
# Disable hello-app 1.0.0 (unscoped)
curl -X POST -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/workers/_/hello-app/1.0.0/disable"

# Re-enable a scoped worker version
curl -X POST -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/workers/@acme/api/0.1.0/enable"
```

`GET /api/workers` returns `disabledVersions: string[]` per worker so the
cpanel can render the right toggle state. Requires `workers:install`.

> [!NOTE]
> Enable/disable is exposed in the cpanel as a per-row action in the Workers
> file-browser dropdown (on the version folder). The same pattern exists for
> plugins in the Plugins tab.

### `DELETE /api/workers/:scope/:name[/:version]`

Without version: removes the entire worker (all versions). With version:
removes only that version.

```bash
# Full scoped worker
curl -X DELETE -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/workers/@buntime/my-worker"

# Specific version
curl -X DELETE -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/workers/@buntime/my-worker/1.0.0"

# Non-scoped worker — use `_` as scope
curl -X DELETE -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/workers/_/my-worker"
```

Built-in workers cannot be removed. The runtime returns `403` with
`BUILT_IN_WORKER_REMOVE_FORBIDDEN` or `BUILT_IN_WORKER_VERSION_REMOVE_FORBIDDEN`.

## Plugins

### `GET /api/plugins`

Lists plugins detected in `RUNTIME_PLUGIN_DIRS`. The runtime uses the filesystem
only to discover candidate package roots; the public `name` comes from package
metadata (`manifest.yaml`, `manifest.yml`, or `package.json`). Folders without
package metadata are ignored because they are outside the supported plugin
package format.

```json
[
  {
    "name": "@buntime/plugin-keyval",
    "path": "/data/.plugins/plugin-keyval",
    "removable": false,
    "source": "built-in"
  },
  {
    "name": "@acme/plugin-custom",
    "path": "/data/plugins/@acme/plugin-custom",
    "removable": true,
    "source": "uploaded"
  }
]
```

`source` and `removable` follow the same rule as apps: anything from the
Buntime project/image is built-in; external upload roots are uploaded.

### `GET /api/plugins/loaded`

Lists active plugins in the registry (runtime state).

```json
[
  {
    "name": "@buntime/plugin-database",
    "base": "/database",
    "dependencies": [],
    "optionalDependencies": [],
    "menus": [{ "title": "Database", "icon": "lucide:database", "path": "/database" }]
  }
]
```

### `POST /api/plugins/upload`

Same archive contract as `/api/workers/upload` (see above). Difference: install
path **omits the version segment** because the plugin loader does not scan
version subdirectories.

| `name`              | Installed at                       |
|---------------------|-------------------------------------|
| `my-plugin`         | `<pluginDir>/my-plugin/`           |
| `@scope/my-plugin`  | `<pluginDir>/@scope/my-plugin/`    |

`version` from the manifest is read for the response payload but does not
affect the layout. If `<pluginDir>/<name>/` exists, it's removed first.

```bash
curl -X POST \
  -H "X-API-Key: $KEY" \
  -F "file=@plugin-custom.tgz" \
  https://buntime.home/_/api/plugins/upload
```

### `POST /api/plugins/reload`

Re-scans `pluginDirs`, performs a full reload, **and refreshes the live HTTP
server's native route table** (`server.reload()`), so a freshly uploaded
plugin's routes — including `server.routes` — go live without a process
restart. Use after a manual upload or filesystem edit.

```bash
curl -X POST -H "X-API-Key: $KEY" \
  https://buntime.home/_/api/plugins/reload
```

### `POST /api/plugins/:name/enable` and `POST /api/plugins/:name/disable`

Toggle a single plugin's `enabled` flag at runtime (no restart). The name is
URL-encoded; scoped names work. Flips `manifest.enabled` on disk (surgical
edit, comments preserved), rescans, and refreshes routes.

```bash
# Disable a scoped plugin
curl -X POST -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/plugins/%40acme%2Fplugin-x/disable"

# Re-enable it
curl -X POST -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/plugins/%40acme%2Fplugin-x/enable"
```

Response: `{ "success": true, "data": { "name": "@acme/plugin-x", "enabled": false } }`.
Errors: `PLUGIN_NOT_FOUND` (404), `PLUGIN_MANIFEST_NOT_FOUND` (404). Requires
`plugins:install`.

> [!NOTE]
> See [Plugin System — Hot Reload](./plugin-system.md#hot-reload) for why the
> three plugin route surfaces (Hono `routes`, `server.fetch`, `server.routes`)
> reach the live server differently.

### `DELETE /api/plugins/:name`

`name` must be URL-encoded.

```bash
# Remove @buntime/plugin-custom
curl -X DELETE -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/plugins/%40buntime%2Fplugin-custom"
```

Built-in plugins cannot be removed. The runtime returns `403` with
`BUILT_IN_PLUGIN_REMOVE_FORBIDDEN`.

## API Keys

### `GET /api/keys`

Lists non-revoked keys. **The secret is never returned**, only `keyPrefix`.

```json
{
  "keys": [
    {
      "id": 1,
      "name": "Deploy CI",
      "keyPrefix": "btk_abcd1234",
      "role": "editor",
      "permissions": ["workers:install", "plugins:install"],
      "createdAt": 1777660000,
      "lastUsedAt": 1777660300
    }
  ]
}
```

### `GET /api/keys/meta`

Returns supported roles and permissions. Used by CLI/TUI/CPanel to populate
forms.

### `POST /api/keys`

Creates a key. **The full secret is returned only once** — the client must save
it immediately.

```bash
curl -X POST -H "X-API-Key: $ROOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Deploy CI","role":"editor","expiresIn":"1y"}' \
  https://buntime.home/_/api/keys
```

`expiresIn` accepts `never`, `30d`, `90d`, `1y`, or compact duration (`7d`,
`2w`, `6m`).

Response:

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Deploy CI",
    "key": "btk_...",         // the only time this appears
    "keyPrefix": "btk_abcd1234",
    "role": "editor"
  }
}
```

### `DELETE /api/keys/:id`

Revokes a key. The key being used to make the request **cannot** self-revoke
(protection).

## Documentation

| Route | Content |
|-------|---------|
| `GET /api/openapi.json` | OpenAPI 3.1 spec |
| `GET /api/docs` | Interactive Scalar UI |

## Headers

### Request

| Header | Description |
|--------|-------------|
| `Authorization: Bearer <key>` | Alternative to `X-API-Key` |
| `X-API-Key: <key>` | Master key or generated key |
| `X-Buntime-Internal: true` | Bypass CSRF (worker → runtime) |
| `X-Request-Id` | Correlation (auto-generated if absent) |
| `Origin` | Required for mutating methods (CSRF) |

### Response

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Correlation for tracing/logs |

## Error Format

All error responses follow:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

Error codes per endpoint are documented in the tables above.

## Rate Limiting

Not implemented in the runtime. When enabled, it is the responsibility of
`@buntime/plugin-gateway`. Configure it in the gateway manifest.

## Composite Examples

```bash
# 1. Create admin key from root key
curl -X POST -H "X-API-Key: $ROOT_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Browser Admin","role":"admin","expiresIn":"30d"}' \
  https://buntime.home/_/api/keys | jq -r '.data.key' > admin-key.txt

# 2. Discovery + health check
API=$(curl -s https://buntime.home/.well-known/buntime | jq -r '.api')
curl -s https://buntime.home${API}/health/ready

# 3. Upload + reload a plugin
curl -X POST -H "X-API-Key: $KEY" -F "file=@plugin-custom.tgz" \
  https://buntime.home/_/api/plugins/upload \
  && curl -X POST -H "X-API-Key: $KEY" \
       https://buntime.home/_/api/plugins/reload

# 4. Validate admin session in CPanel
curl -H "X-API-Key: $BROWSER_KEY" \
  https://buntime.home/_/api/admin/session | jq '.principal.permissions'
```

## CPanel — Notes

The CPanel is published at `/cpanel/` (e.g. `https://buntime.home/cpanel/overview`
is the default landing). Runtime sections (`overview`, `keys`, `apps`,
`plugins`) are first-class routes under `/cpanel/`; there is **no `/cpanel/admin`
subpath**. Behavior:

- Login: form asks for `X-API-Key`. Saved in `sessionStorage` under
  `buntime:cpanel-api-key`.
- Auth: uses `/api/admin/session` exclusively. Does not depend on `plugin-authn`.
- `plugin-authn` **cannot** block the cpanel — its `manifest.yaml` marks
  `publicRoutes: { GET: ["/**"] }`, so the SPA bundle is always reachable;
  the SPA itself enforces the API-key gate client-side.
- Frontend uses only the returned `permissions` to hide actions; real
  authorization stays in the runtime.
- Discovery: the frontend reads `/.well-known/buntime` and automatically adapts
  to `/api` or `/_/api`.

Operations available in the admin:

| Category | Actions |
|----------|---------|
| Keys | List, create (admin/editor/viewer/custom), revoke (except the one in use) |
| Apps | List with `built-in`/`uploaded` source, upload (`.zip`/`.tgz`/`.tar.gz`), remove only uploaded app/version |
| Plugins | List (filesystem + loaded) with `built-in`/`uploaded` source, upload, reload, remove only uploaded plugins |

## Related Documentation

- [@buntime/runtime](./runtime.md) — `RUNTIME_API_PREFIX`, CSRF, headers.
- [Worker Pool](./worker-pool.md) — `/api/workers/*` endpoints (metrics/stats).
- [Plugin System](./plugin-system.md) — `POST /api/plugins/reload` and hot reload.
