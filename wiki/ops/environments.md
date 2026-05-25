---
title: "Environment variables and data directories"
audience: ops
sources:
  - apps/runtime/docs/deployment/configuration.md
  - apps/runtime/docs/concepts/overview.md
  - .agents/rules/architecture.md
  - apps/runtime/docs/concepts/plugin-system.md
updated: 2026-05-02
tags: [environments, config, env-vars]
status: stable
---

# Environment variables and data directories

> Operational reference for the Buntime runtime: core and core-plugin environment variables, per-environment defaults, `/data` directory layout, and the lookup order used by the loader.

For local configuration, see [Local development](./local-dev.md). For Helm values, see [Helm charts](./helm-charts.md). For plugin-specific configuration, see the docs under [`../apps/`](../apps/).

## Layered configuration

| Layer | Source | Scope |
|-------|--------|-------|
| Runtime core | Environment variables | Global (port, pool, dirs, log level) |
| Plugins | `manifest.yaml` per plugin | Static config + `${VAR}` interpolation |
| Workers/apps | `manifest.yaml` per app | TTL, timeouts, extra env, `maxBodySize` |
| Build-time | `bunfig.toml` | Bun build plugins |

> Plugin/app `manifest.yaml` details live in [`../apps/`](../apps/) — this page covers only the runtime level.

## Runtime core variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `8000` | HTTP port for `Bun.serve` |
| `NODE_ENV` | string | `development` | Determines pool size and default log format |
| `RUNTIME_API_PREFIX` | string | `""` | Prefix for the internal API only (e.g., `/_` results in `/_/api/...`); plugin routes are unaffected |
| `RUNTIME_WORKER_DIRS` | PATH (`:`) | `/data/.apps:/data/apps` | Parent directories containing apps |
| `RUNTIME_PLUGIN_DIRS` | PATH (`:`) | `/data/.plugins:/data/plugins` | Parent directories containing plugins |
| `RUNTIME_POOL_SIZE` | number | env-based (see below) | Maximum worker pool size |
| `RUNTIME_EPHEMERAL_CONCURRENCY` | number | `2` | Maximum concurrency for `ttl: 0` workers before queuing |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | number | `100` | Maximum queue depth for `ttl: 0` requests before returning `503` |
| `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | number | `1000` | Worker manifest cache TTL (`0` disables) |
| `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | number | `1000` | Directory resolution cache TTL (`0` disables) |
| `RUNTIME_LOG_LEVEL` | string | `info` (prod) / `debug` (dev) | Minimum level (`debug` \| `info` \| `warn` \| `error`) |
| `DELAY_MS` | number | `100` | Delay for graceful operations (shutdown, idle) |

> **Important**: the separator is always `:` (PATH style). Commas are not accepted.

### Pool size per environment

When `RUNTIME_POOL_SIZE` is not set, the runtime resolves it from `NODE_ENV`:

| `NODE_ENV` | Default pool size |
|------------|-------------------|
| `production` | `500` |
| `staging` | `50` |
| `development` | `10` |
| `test` | `5` |

`charts/values.base.yaml` explicitly forces `100` in production via `buntime.poolSize` — the default value only applies when running the runtime outside the chart. For load tuning, see `apps/runtime/docs/performance.md`.

### Body limits

| Limit | Value | Configurable by |
|-------|-------|-----------------|
| `bodySize.default` | 10 MB | Worker via `maxBodySize` in `manifest.yaml` |
| `bodySize.max` | 100 MB | Global ceiling (workers that exceed it are capped and generate a `WARN`) |

Exceeded? `413 Payload Too Large`.

## Core plugin variables

Core plugins read configuration from `manifest.yaml` but accept environment variables for deploy-time overrides. The tables below list only variables with defaults — auth tokens and similar are optional.

### plugin-database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_LIBSQL_URL` | `http://libsql:8080` | Primary LibSQL URL |
| `DATABASE_LIBSQL_REPLICAS_N` | — | Indexed replica URL (`N=1,2,...`) |
| `DATABASE_LIBSQL_AUTH_TOKEN` | — | JWT token (optional) |

### plugin-gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_CORS_CREDENTIALS` | `false` | `Access-Control-Allow-Credentials` |
| `GATEWAY_CORS_ORIGIN` | `*` | Allowed origins |
| `GATEWAY_RATE_LIMIT_REQUESTS` | `100` | Requests per window |
| `GATEWAY_RATE_LIMIT_WINDOW` | `1m` | Rate limit window |
| `GATEWAY_SHELL_DIR` | `""` | Micro-frontend app shell path |
| `GATEWAY_SHELL_EXCLUDES` | `cpanel` | Basenames that bypass the shell |

### plugin-deployments

| Variable | Default | Description |
|----------|---------|-------------|
| `DEPLOYMENTS_EXCLUDES` | `.cache, lost+found` | Directories ignored during listing |

### External plugins

| Variable | Plugin | Description |
|----------|--------|-------------|
| `LIBSQL_URL` | database, keyval | LibSQL URL (interpolated via `${LIBSQL_URL}`) |
| `LIBSQL_TOKEN` | database | LibSQL auth token |
| `KEYCLOAK_URL` | authn | Keycloak issuer |
| `FRONT_MANAGER_API` | resource-tenant (external) | Fatal error if missing |

## Data directories

| Path | Origin | Contents | Writable |
|------|--------|----------|----------|
| `/data/.apps` | Docker image | Core apps | No |
| `/data/.plugins` | Docker image | Core plugins | No |
| `/data/apps` | PVC | External apps (user deploys) | Yes |
| `/data/plugins` | PVC | External plugins | Yes |

### Lookup order

The rule is simple: **core (`.apps`/`.plugins`) first, external (`apps`/`plugins`) second**.

```
RUNTIME_WORKER_DIRS=/data/.apps:/data/apps
RUNTIME_PLUGIN_DIRS=/data/.plugins:/data/plugins
```

Each listed directory is a **parent** that contains subdirectories (one per app/plugin). Pointing to an individual app does not work — the loader only discovers direct children.

### Built-in vs uploaded

The runtime uses directory origin to classify installed apps/plugins:

- **Built-in**: any directory that is hidden (`.apps`, `.plugins`) or lives
  inside the Buntime project/image.
- **Uploaded**: any configured app/plugin directory outside the Buntime project,
  such as `/data/apps` or `/data/plugins` mounted from a PVC.

Uploads must target an uploaded directory. If only built-in roots are
configured, the upload endpoint fails instead of writing into project/image
content. Delete operations are allowed only for uploaded rows.

### Plugin resolution

1. **Built-in** — embedded in the binary/image (always available)
2. **External** — discovered from `RUNTIME_PLUGIN_DIRS`
3. **Node modules** — only in dev mode (`bun dev`)

Version conflicts (same name in two folders) are resolved by the first occurrence in PATH order. For details on the plugin loader, see [Plugin System in `../apps/`](../apps/).

## Reserved paths

Plugins cannot use the following as their `base`:

- `/api`
- `/health`
- `/.well-known`

Attempting to register a plugin with `base: /api` aborts startup. Details in [Security](./security.md#reserved-paths).

## `${VAR}` interpolation in manifests

Plugin/app `manifest.yaml` files support interpolation at startup:

```yaml
adapters:
  - type: libsql
    urls:
      - "${LIBSQL_URL}"
    authToken: "${LIBSQL_TOKEN}"
```

This allows the same config to run across dev/staging/prod by simply swapping the `.env` file. Do not confuse this with Helm templating — interpolation happens at runtime, inside the plugin loader.

## Startup validation

Common errors abort the boot with a clear message:

| Error | Cause |
|-------|-------|
| `Plugin "X" requires "Y" which is not available` | Declared dependency is not in `pluginDirs` or has `enabled: false` |
| `Circular dependency detected among plugins: ...` | Cycle in the dependency graph |
| `Plugin "X" manifest is missing required field: name` | Invalid manifest |
| `Plugin "X" cannot use reserved path "/api"` | Plugin attempted to use a reserved path |

More details in [Security](./security.md) and the individual plugin docs under [`../apps/`](../apps/).
