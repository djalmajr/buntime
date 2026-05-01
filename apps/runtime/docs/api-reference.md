# API Reference

The runtime exposes a REST API for health checks, plugin management, and app management.
By default it is mounted at `/api/*`. When `RUNTIME_API_PREFIX="/_"`, the API
is mounted at `/_/api/*`.

> [!TIP]
> Clients should read `/.well-known/buntime` and use the returned `api` path
> instead of hardcoding `/api` or `/_/api`.

## Base URL

```
http://localhost:8000/api
```

Prefixed deployment example:

```
https://buntime.home/_/api
```

## Authentication

API routes are protected by CSRF validation for state-changing requests (POST, PUT, DELETE, PATCH). Requests must include a valid `Origin` header matching the server's origin.

For internal requests (worker-to-runtime), include the `X-Buntime-Internal: true` header to bypass CSRF validation.

When `RUNTIME_MASTER_KEY` is configured, protected API routes also require
`X-API-Key: <key>` or `Authorization: Bearer <key>`. The master key is intended
for bootstrap/admin automation such as creating scoped deploy keys from the
CLI/TUI. It bypasses CSRF and plugin `onRequest` hooks, so store it as a secret
and do not expose it to browsers.

Helm exposes this as `buntime.masterKey`, stored in the runtime Secret.

Runtime API keys created through `/api/keys` are stored as SHA-256 hashes in a
file-backed store under `RUNTIME_STATE_DIR`. If `RUNTIME_STATE_DIR` is not set,
the runtime uses the first external plugin directory, usually
`/data/plugins/.buntime/api-keys.json` in the Helm chart. Roles are enforced on
core API routes:

| Role | Access |
|------|--------|
| `admin` | All permissions |
| `editor` | Install/remove apps and plugins, plugin config, worker operations |
| `viewer` | Read-only apps, plugins, workers, and keys |
| `custom` | Explicit permissions selected at creation time |

## Health Endpoints

### GET /api/health/

Returns the overall health status of the runtime.

**Response**

```json
{
  "ok": true,
  "status": "healthy",
  "version": "1.0.0"
}
```

### GET /api/health/ready

Kubernetes readiness probe endpoint. Returns 200 when the runtime is ready to accept requests.

**Response**

```json
{
  "ok": true,
  "status": "ready",
  "version": "1.0.0"
}
```

### GET /api/health/live

Kubernetes liveness probe endpoint. Returns 200 when the runtime is alive.

**Response**

```json
{
  "ok": true,
  "status": "live",
  "version": "1.0.0"
}
```

## Plugin Endpoints

### GET /api/plugins/

Lists all plugins installed in `pluginDirs` (filesystem scan).

**Response**

```json
[
  {
    "name": "plugin-database",
    "path": "/plugins/plugin-database"
  },
  {
    "name": "@buntime/plugin-keyval",
    "path": "/plugins/@buntime/plugin-keyval"
  }
]
```

### GET /api/plugins/loaded

Lists all currently loaded plugins from the registry (runtime state).

**Response**

```json
[
  {
    "name": "@buntime/plugin-database",
    "base": "/database",
    "dependencies": [],
    "optionalDependencies": [],
    "menus": [
      {
        "title": "Database",
        "icon": "lucide:database",
        "path": "/database"
      }
    ]
  }
]
```

### POST /api/plugins/reload

Re-scans `pluginDirs` and reloads all plugins. Useful after uploading new plugins or modifying plugin files.

**Response**

```json
{
  "ok": true,
  "plugins": [
    {
      "name": "@buntime/plugin-database",
      "base": "/database"
    }
  ]
}
```

### POST /api/plugins/upload

Uploads and installs a plugin from a tarball or zip archive.

**Request**

```
Content-Type: multipart/form-data

file: <archive file> (.tgz, .tar.gz, or .zip)
```

**Response**

```json
{
  "success": true,
  "data": {
    "plugin": {
      "name": "@buntime/plugin-custom",
      "version": "1.0.0",
      "installedAt": "/plugins/@buntime/plugin-custom"
    }
  }
}
```

**Errors**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `NO_PLUGIN_DIRS` | No `pluginDirs` configured |
| 400 | `NO_FILE_PROVIDED` | No file in request |
| 400 | `INVALID_FILE_TYPE` | File must be .tgz, .tar.gz, or .zip |
| 400 | `PATH_TRAVERSAL` | Invalid package name (security) |

### DELETE /api/plugins/:name

Removes a plugin from the filesystem.

**Parameters**

| Name | In | Description |
|------|-----|-------------|
| `name` | path | Plugin name (URL encoded). Example: `%40buntime%2Fplugin-custom` |

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `MISSING_NAME` | Plugin name is required |
| 404 | `PLUGIN_NOT_FOUND` | Plugin files not found |

## App Endpoints

### GET /api/apps/

Lists all apps installed in `workerDirs`.

**Response**

```json
[
  {
    "name": "my-app",
    "path": "/apps/my-app",
    "versions": ["1.0.0", "1.1.0"]
  },
  {
    "name": "@company/dashboard",
    "path": "/apps/@company/dashboard",
    "versions": ["2.0.0"]
  }
]
```

### POST /api/apps/upload

Uploads and installs an app from a tarball or zip archive.

**Request**

```
Content-Type: multipart/form-data

file: <archive file> (.tgz, .tar.gz, or .zip)
```

The archive must contain a `package.json` with `name` and `version` fields.

**Response**

```json
{
  "success": true,
  "data": {
    "app": {
      "name": "@company/my-app",
      "version": "1.0.0",
      "installedAt": "/apps/@company/my-app/1.0.0"
    }
  }
}
```

**Errors**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `NO_WORKER_DIRS` | No `workerDirs` configured |
| 400 | `NO_FILE_PROVIDED` | No file in request |
| 400 | `INVALID_FILE_TYPE` | File must be .tgz, .tar.gz, or .zip |
| 400 | `PATH_TRAVERSAL` | Invalid package name (security) |

### DELETE /api/apps/:scope/:name

Removes an app and all its versions from the filesystem.

**Parameters**

| Name | In | Description |
|------|-----|-------------|
| `scope` | path | App scope (e.g., `@buntime`) or unscoped name |
| `name` | path | App name |

**Example**

```bash
# Scoped app
DELETE /api/apps/@buntime/my-app

# Unscoped app
DELETE /api/apps/_/my-app
```

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `MISSING_PARAMS` | Scope and name are required |
| 404 | `APP_NOT_FOUND` | App not found |

### DELETE /api/apps/:scope/:name/:version

Removes a specific version of an app.

**Parameters**

| Name | In | Description |
|------|-----|-------------|
| `scope` | path | App scope (e.g., `@buntime`) or unscoped name |
| `name` | path | App name |
| `version` | path | Version to delete |

**Example**

```bash
DELETE /api/apps/@buntime/my-app/1.0.0
```

**Response**

```json
{
  "success": true
}
```

**Errors**

| Status | Code | Description |
|--------|------|-------------|
| 400 | `MISSING_PARAMS` | Scope, name and version are required |
| 404 | `VERSION_NOT_FOUND` | App version not found |

## API Key Endpoints

### GET /api/keys/

Lists non-revoked API keys. Secret key values are never returned by this
endpoint.

**Response**

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

### GET /api/keys/meta

Returns supported roles and permissions for CLI/TUI forms.

### POST /api/keys/

Creates an API key. The full key is returned only once.

**Request**

```json
{
  "name": "Deploy CI",
  "role": "editor",
  "expiresIn": "1y"
}
```

`expiresIn` accepts `never`, `30d`, `90d`, `1y`, or another compact duration
such as `7d`, `2w`, `6m`.

**Response**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Deploy CI",
    "key": "btk_...",
    "keyPrefix": "btk_abcd1234",
    "role": "editor"
  }
}
```

### DELETE /api/keys/:id

Revokes an API key.

**Response**

```json
{
  "success": true
}
```

## Documentation Endpoints

### GET /api/openapi.json

Returns the OpenAPI 3.1 specification for the API.

### GET /api/docs

Interactive API documentation powered by Scalar UI.

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

## Request Headers

| Header | Description |
|--------|-------------|
| `Authorization` | `Bearer <key>` alternative to `X-API-Key` |
| `X-API-Key` | Runtime master key or generated API key |
| `X-Buntime-Internal` | Set to `true` for internal requests (bypasses CSRF) |
| `X-Request-Id` | Correlation ID for request tracing (auto-generated if not provided) |
| `Origin` | Required for state-changing requests (CSRF protection) |

## Response Headers

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Correlation ID for request tracing |

## Rate Limiting

Rate limiting is handled by the `@buntime/plugin-gateway` if enabled. See the gateway plugin documentation for configuration options.
