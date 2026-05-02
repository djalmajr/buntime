---
title: "Local development"
audience: dev
sources:
  - .agents/rules/dev-setup.md
  - .agents/rules/docker.md
  - apps/runtime/docs/deployment/local.md
updated: 2026-05-02
tags: [local-dev, docker, hot-reload]
status: stable
---

# Local development

> Guide for running Buntime on desktop: monorepo in watch mode, `.env` at the root, external plugins with hot-reload, Docker Compose with profiles, and three binary execution modes (dev, bundle, compiled).

For environment variables and directories, see [Environments](./environments.md). For Kubernetes deploy, see [Helm charts](./helm-charts.md).

## TL;DR

```bash
# From the monorepo root
bun install
bun dev
```

This starts in parallel:

- `@buntime/runtime` in watch mode
- `@buntime/cpanel` in watch mode
- Each `@buntime/plugin-*` core in watch mode

With no additional configuration, the runtime listens on `http://localhost:8000` and the cpanel is available at `/cpanel`. Required variables come from the `.env` file at the monorepo root.

> **Gotcha — `bun --watch` vs `bun --hot`**: the runtime's dev script uses `bun --watch`, **not `bun --hot`**. `--hot` breaks timer-driven code (croner doesn't fire after the first reload) and leaks zombie port bindings. If you change the dev script, keep `--watch`.

## `.env` at the root

The `.env` file in `buntime/` configures the runtime and core plugins:

```bash
# Runtime
RUNTIME_PLUGIN_DIRS=/path/to/external-plugins
RUNTIME_WORKER_DIRS=/path/to/buntime-apps:/path/to/edge-functions

# plugin-gateway (app shell)
GATEWAY_SHELL_DIR=/path/to/functions/app-shell
GATEWAY_SHELL_EXCLUDES=cpanel
```

Important rules:

- **`RUNTIME_WORKER_DIRS` and `RUNTIME_PLUGIN_DIRS` point to parents**, not to individual apps/plugins. The loader scans direct children.
- **Separator is `:`** (PATH style). Commas do not work.
- Core plugins from the monorepo (`plugins/*`) are automatically loaded via `node_modules` when the runtime runs in dev mode — no need to add `plugins/` to `RUNTIME_PLUGIN_DIRS`.
- External plugins without `dist/plugin.js` are silently ignored.

## External plugins in watch mode

Plugins outside the monorepo (in other repos) load via `RUNTIME_PLUGIN_DIRS`. For simultaneous hot-reload:

```bash
# Terminal 1 — runtime + cpanel + core plugins
cd /path/to/buntime
bun dev

# Terminal 2 — external plugin in watch mode
cd /path/to/external-plugins/plugin-foo
bun dev

# Terminal 3 — another external plugin
cd /path/to/external-plugins/plugin-bar
bun dev
```

For a one-time build without watch:

```bash
cd /path/to/external-plugins/plugin-foo
bun run build
```

> **Note**: the runtime does **not** automatically reload when `dist/plugin.js` changes. You must restart `bun dev` for the runtime to pick up the new build.

## Three execution modes

| Mode | Command | Use case | Size |
|------|---------|----------|------|
| **Dev** | `bun dev` | Hot reload, debugging, source maps | — |
| **Bundle** | `bun run dist/index.ts` | Production-like, requires Bun | ~1.5 MB |
| **Compiled** | `./dist/buntime` | Standalone, no Bun required | ~130 MB |

### Dev

Hot reload + source maps. Plugins load from `node_modules`. Slower startup.

```bash
cd apps/runtime
bun dev
```

### Bundle

Bundles the runtime but requires Bun to run:

```bash
cd apps/runtime
bun run build
bun run dist/index.ts
```

Output in `dist/`: `index.ts` (~1.3 MB) + `wrapper.ts` (~23 KB).

### Compiled

Standalone binary with everything embedded (Bun + core plugins):

```bash
cd apps/runtime
bun run build:bin
./dist/buntime
```

Configuration via env vars or a `.env` file in the execution directory:

```bash
RUNTIME_WORKER_DIRS=/apps RUNTIME_PLUGIN_DIRS=/plugins ./dist/buntime
```

> **Watch out for LibSQL `file:` URLs**: always use absolute paths. Relative paths break in the compiled binary.

Comparison:

| Feature | Dev | Bundle | Compiled | Docker |
|---------|-----|--------|----------|--------|
| Hot reload | Yes | No | No | Yes (dev profile) |
| Requires Bun | Yes | Yes | No | No |
| Size | — | ~1.5 MB + Bun | ~130 MB | ~132 MB |
| Core plugins | node_modules | Embedded | Embedded | Embedded |

## Docker Compose

Two profiles: `dev` (hot reload, source mounted) and `prod` (compiled binary).

```bash
# Hot reload with source mounted
docker-compose --profile dev up

# Production image
docker-compose --profile prod up

# Force rebuild
docker-compose --profile dev up --build

# Background
docker-compose --profile dev up -d

# Logs
docker-compose --profile dev logs -f buntime

# Shell into container
docker exec -it buntime sh

# Stop and remove volumes
docker-compose --profile dev down -v
```

### Dev profile volumes

| Container | Local | Purpose |
|-----------|-------|---------|
| `/build/packages` | `./packages` | Source hot reload |
| `/build/apps` | `./apps` | Source hot reload |
| `/build/plugins` | `./plugins` | Source hot reload |
| `/data/.apps` | `./apps` | Core apps (image symlink) |
| `/data/.plugins` | `./plugins` | Core plugins |
| `/data/apps` | `${RUNTIME_WORKER_DIRS}` or `./tmp/apps` | External apps |
| `/data/plugins` | `${RUNTIME_PLUGIN_DIRS}` or `./tmp/plugins` | External plugins |

### Dev profile variables

```yaml
NODE_ENV: development
PORT: 8000
RUNTIME_API_PREFIX: /_
RUNTIME_LOG_LEVEL: debug
RUNTIME_PLUGIN_DIRS: /data/.plugins:/data/plugins
RUNTIME_WORKER_DIRS: /data/.apps:/data/apps
RUNTIME_POOL_SIZE: 10
DATABASE_LIBSQL_URL: http://libsql:8080
GATEWAY_SHELL_DIR: /data/apps/example-spa
```

### LibSQL service

Runtime dependency (plugin-database points to `http://libsql:8080`):

| Port | Use |
|------|-----|
| `8880:8080` | HTTP API |
| `8881:5001` | gRPC (replication) |

`SQLD_DISABLE_AUTH: "true"` — **dev only**. In production, use a token via `DATABASE_LIBSQL_AUTH_TOKEN` or `LIBSQL_TOKEN`.

## Troubleshooting

### Container fails to start

```bash
docker-compose --profile dev logs buntime
lsof -i :8000   # check if the port is in use
```

### LibSQL unreachable

```bash
docker-compose --profile dev ps
curl http://localhost:8880/health
```

### Hot reload not triggering

1. Confirm that volumes under `/build/*` are mounted
2. Confirm `NODE_ENV=development`
3. On macOS/Windows with Docker Desktop, the file watcher may be limited by `inotify` — restart the service

### Permissions (Linux)

```bash
sudo chown -R $USER:$USER ./tmp
```

### External plugin not showing up

Symptom: plugin does not appear in `GET /api/plugins`. Common causes:

1. `dist/plugin.js` does not exist — run `bun run build` inside the plugin
2. `manifest.yaml` is missing or has no `name` field
3. `RUNTIME_PLUGIN_DIRS` is pointing to the individual plugin instead of its parent
4. Build was updated but the runtime was not restarted

### `FRONT_MANAGER_API is required`

The `plugin-resource-tenant` plugin is fatal if this env var is not set. Define it in the root `.env` or disable the plugin (`enabled: false` in `manifest.yaml`).

## Systemd (running the compiled binary on a VM)

```ini
# /etc/systemd/system/buntime.service
[Unit]
Description=Buntime Runtime
After=network.target

[Service]
Type=simple
User=buntime
Group=buntime
WorkingDirectory=/opt/buntime
ExecStart=/opt/buntime/buntime
Restart=always
RestartSec=5
Environment=PORT=8000
Environment=RUNTIME_WORKER_DIRS=/opt/buntime/apps
Environment=RUNTIME_LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now buntime
sudo systemctl status buntime
```
