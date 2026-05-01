# Buntime

Worker Pool Runtime for Bun applications. Runs isolated worker processes with a plugin system for extending functionality.

## Features

- **Worker Pool**: Ephemeral (per-request) and persistent (TTL) worker modes
- **Plugin System**: Core plugins built into the image + external plugins via PVC
- **Micro-frontend**: App-shell architecture with `z-frame` web component
- **CPanel**: Built-in admin UI for managing apps, plugins, and configuration

## Core Plugins

| Plugin | Description |
|--------|-------------|
| **plugin-database** | LibSQL/SQLite/PGlite database adapter with HRANA WebSocket |
| **plugin-keyval** | Key-value store with FTS, atomic operations, queue, and SSE watch |
| **plugin-gateway** | CORS, rate limiting, app-shell routing, metrics dashboard |
| **plugin-proxy** | HTTP reverse proxy with regex rules, WebSocket, drag-and-drop ordering |
| **plugin-deployments** | App deployment management with batch operations |

## Configuration

Key values to configure:

| Value | Description | Default |
|-------|-------------|---------|
| `buntime.apiPrefix` | API route prefix | `"/_"` |
| `buntime.workerDirs` | Worker search paths | `/data/.apps:/data/apps` |
| `buntime.pluginDirs` | Plugin search paths | `/data/.plugins:/data/plugins` |
| `buntime.ephemeralConcurrency` | Max concurrent `ttl: 0` requests | `2` |
| `buntime.ephemeralQueueLimit` | Max queued `ttl: 0` requests before `503` | `100` |
| `resources.requests.cpu` | CPU request per pod | `250m` |
| `resources.limits.cpu` | CPU limit per pod | `2` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `podDisruptionBudget.enabled` | Enable PDB | `false` |
| `plugins.database.libsqlUrl` | LibSQL primary URL | `http://libsql:8080` |
| `plugins.gateway.cors.origin` | CORS allowed origins | `*` |
| `plugins.gateway.shellDir` | Micro-frontend shell path | `""` |
| `ingress.host` | Ingress hostname | `""` (disabled) |

## Volumes

| Path | Type | Content |
|------|------|---------|
| `/data/.apps` | Image | Core apps (built-in) |
| `/data/.plugins` | Image | Core plugins (built-in) |
| `/data/apps` | PVC | External apps |
| `/data/plugins` | PVC | External plugins |

## Links

- [Source Code](https://github.com/zommehq/buntime)
- [Documentation](https://github.com/zommehq/buntime/tree/main/apps/runtime/docs)
