---
title: Environment variables
description: How the runtime, plugins, and workers are configured — environment variables, defaults, and the configuration flow.
sidebar:
  order: 1
---

Buntime has three configuration scopes, each with its own mechanism:

| Scope | Mechanism | What it controls |
|-------|-----------|------------------|
| Runtime core | Environment variables | Port, pool size, directories, log level, auth |
| Plugins | `manifest.yaml` per plugin (`config`/`env`) | Plugin behavior; surfaced as `Bun.env` via Helm/ConfigMap |
| Workers / apps | `manifest.yaml` + `.env` in the app dir | Per-app `Bun.env` (sensitive keys filtered out) |

## Runtime environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | HTTP port |
| `NODE_ENV` | `development` | `development` \| `production` \| `staging` \| `test` |
| `RUNTIME_WORKER_DIRS` | **required** | App directories (PATH style, `:`-separated) |
| `RUNTIME_PLUGIN_DIRS` | `/data/.plugins:/data/plugins` | Plugin directories (built-in first) |
| `RUNTIME_POOL_SIZE` | env-based | Maximum worker pool size |
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Max in-flight requests for `ttl: 0` apps |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Max queue depth for `ttl: 0` before `503` |
| `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` | Manifest cache TTL |
| `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` | Resolver cache TTL |
| `RUNTIME_LOG_LEVEL` | `info` (prod) / `debug` (dev) | Log level |
| `RUNTIME_API_PREFIX` | (empty) | Moves the internal API: `""` → `/api`, `"/_"` → `/_/api` |
| `RUNTIME_ROOT_KEY` | (optional) | Bootstrap root key (synthetic `root` principal, full access) |
| `RUNTIME_STATE_DIR` | (optional) | Where to store `api-keys.db` (bun:sqlite) |
| `DELAY_MS` | `100` | Delay before terminating a worker |

Pool-size defaults by environment: `development` = 10, `staging` = 50,
`production` = 500, `test` = 5.

:::caution[PATH-style, never commas]
Multi-value variables (`RUNTIME_WORKER_DIRS`, `RUNTIME_PLUGIN_DIRS`) use `:` as
the separator — never `,`.
:::

## Worker environment

Workers do **not** inherit the runtime environment. They receive a curated set
(`APP_DIR`, `ENTRYPOINT`, `WORKER_ID`, `WORKER_CONFIG`, `NODE_ENV`, `RUNTIME_*`,
`RUNTIME_API_URL`) plus anything declared in the app's `manifest.env` / `.env` —
after sensitive patterns (keys, tokens, passwords, DB URLs, cloud-provider
credentials) are stripped. The full list and blocked patterns are in
[Worker Pool → Environment variables](/concepts/worker-pool/#environment-variables-passed-to-workers).

## Configuration flow

| Source | Destination | Path |
|--------|-------------|------|
| Built-in plugin | `Bun.env` | `manifest.config` → Helm generation → `values.yaml` + `configmap.yaml` → k8s ConfigMap → `Bun.env` |
| Uploaded plugin | `PluginContext.config` | `manifest.yaml` → loader rescan → injected as `ctx.config` |
| Worker | the worker's `Bun.env` | `manifest.env` → `loadWorkerConfig()` → injected on spawn |

Plugins always read with a fallback: `Bun.env.X ?? config.x ?? "default"`.

## Related

- [Runtime](/concepts/runtime/) — where these variables are consumed.
- [Worker Pool](/concepts/worker-pool/) — per-worker config and env filtering.
- [Helm & Kubernetes](/ops/helm-kubernetes/) — how config reaches a cluster.
