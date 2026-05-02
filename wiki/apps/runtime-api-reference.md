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
API key management. Used by the CLI/TUI, the CPanel admin (`/cpanel/admin`),
and CI automation.

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

### 2. Master Key (`RUNTIME_MASTER_KEY`)

Bootstrap key. Used by the CLI/TUI to create initial scoped keys.

```bash
curl -H "X-API-Key: $MASTER_KEY" ...
# or
curl -H "Authorization: Bearer $MASTER_KEY" ...
```

The master key:

- Bypasses CSRF.
- Bypasses plugin `onRequest` hooks.
- Appears as synthetic principal `master` with `role=admin`.
- Helm exposes it as `buntime.masterKey` in the Secret.

> Do not expose the master key to the browser. It is for bootstrap only.

### 3. API Keys (created via API)

Keys generated via `POST /api/keys`. Stored as SHA-256 hashes in
`api-keys.json` under `RUNTIME_STATE_DIR` (or the first external `pluginDir`;
typically `/data/plugins/.buntime/api-keys.json` in the Helm chart).

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
| Apps | `/api/apps` | List, upload, delete apps |
| Plugins | `/api/plugins` | List, upload, reload, delete plugins |
| Keys | `/api/keys` | List, create, revoke API keys |
| Docs | `/api/openapi.json`, `/api/docs` | Spec + Scalar UI |

Details per group below.

## Admin

### `GET /api/admin/session`

Validates `X-API-Key` for the CPanel admin. Does **not** depend on `plugin-authn`.
The CPanel admin (`/cpanel/admin`) uses exclusively this endpoint, keeping the
key in the browser's `sessionStorage` (removed when the tab is closed).

```bash
curl -H "X-API-Key: $KEY" https://buntime.home/_/api/admin/session
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
    "permissions": ["apps:read", "apps:install", "keys:read"]
  }
}
```

The master key returns the synthetic `master` principal with admin permissions.
The frontend uses `permissions` only to show/hide UI — real authorization
happens in the runtime.

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

## Apps

### `GET /api/apps`

Lists apps in `RUNTIME_WORKER_DIRS`. The runtime uses the filesystem only to
discover candidate package roots; the public `name` and `version` come from
package metadata (`manifest.yaml`, `manifest.yml`, or `package.json`). Folders
without package metadata are ignored because they are outside the supported app
package format.

```json
[
  {
    "name": "my-app",
    "path": "/data/apps/my-app",
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
and `uploaded` for external app roots such as `/data/apps`. Only uploaded apps
are removable.

### `POST /api/apps/upload`

Upload via multipart/form-data. Accepts `.tgz`, `.tar.gz`, `.zip`. The archive
must contain a `package.json` with `name` and `version`.

```bash
curl -X POST \
  -H "X-API-Key: $KEY" \
  -F "file=@my-app-1.0.0.tgz" \
  https://buntime.home/_/api/apps/upload
```

Errors: `NO_WORKER_DIRS` (400), `NO_FILE_PROVIDED` (400),
`INVALID_FILE_TYPE` (400), `PATH_TRAVERSAL` (400).

### `DELETE /api/apps/:scope/:name[/:version]`

Without version: removes the entire app (all versions). With version: removes
only that version.

```bash
# Full scoped app
curl -X DELETE -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/apps/@buntime/my-app"

# Specific version
curl -X DELETE -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/apps/@buntime/my-app/1.0.0"

# Non-scoped app — use `_` as scope
curl -X DELETE -H "X-API-Key: $KEY" \
  "https://buntime.home/_/api/apps/_/my-app"
```

Built-in apps cannot be removed. The runtime returns `403` with
`BUILT_IN_APP_REMOVE_FORBIDDEN` or `BUILT_IN_APP_VERSION_REMOVE_FORBIDDEN`.

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

```bash
curl -X POST \
  -H "X-API-Key: $KEY" \
  -F "file=@plugin-custom.tgz" \
  https://buntime.home/_/api/plugins/upload
```

### `POST /api/plugins/reload`

Re-scans `pluginDirs` and performs a full reload. Use after a manual upload or
filesystem edit.

```bash
curl -X POST -H "X-API-Key: $KEY" \
  https://buntime.home/_/api/plugins/reload
```

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
      "permissions": ["apps:install", "plugins:install"],
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
curl -X POST -H "X-API-Key: $MASTER_KEY" \
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
# 1. Create admin key from master key
curl -X POST -H "X-API-Key: $MASTER_KEY" -H "Content-Type: application/json" \
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

## CPanel Admin — Notes

The CPanel is published at `/cpanel/admin` (e.g. `https://buntime.home/cpanel/admin`).
Behavior:

- Login: form asks for `X-API-Key`. Saved in `sessionStorage`.
- Auth: uses `/api/admin/session` exclusively. Does not depend on `plugin-authn`.
- `plugin-authn` continues governing `/cpanel` regular and plugin UIs, but
  **cannot** block `/cpanel/admin` — the CPanel's `manifest.yaml` marks
  `/admin`, `/admin/**`, and static assets as `publicRoutes`.
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
