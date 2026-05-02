---
title: "Buntime Storage Overview"
audience: dev
sources:
  - apps/runtime/docs/api-reference.md
  - apps/runtime/docs/concepts/plugin-system.md
  - apps/runtime/docs/concepts/worker-pool.md
  - apps/runtime/docs/security.md
  - apps/runtime/docs/deployment/configuration.md
  - apps/runtime/src/libs/api-keys.ts
  - charts/values.yaml
  - .agents/rules/architecture.md
updated: 2026-05-02
tags: [data, storage, libsql, file-store]
status: stable
---

# Buntime Storage Overview

> Canonical inventory of **where** the runtime and plugins persist data. LibSQL is the default backend for all plugin state; the filesystem (with PVCs in Helm) carries code (apps + plugins) and a single file-backed store (API keys). For detailed plugin schema, see [keyval-tables](./keyval-tables.md).

## Principles

- **LibSQL as default.** Core plugin tables (`plugin-keyval`, `plugin-proxy`, `plugin-deployments`, `plugin-vhosts`, etc.) live in LibSQL via [`@buntime/plugin-database`](../apps/plugin-database.md). Even single-pod deployments use LibSQL embedded or a sidecar — plain SQLite is a dev fallback only.
- **Adapter swap per plugin.** `plugin-database` exposes `getRootAdapter(type?)`, so each plugin can choose `sqlite | libsql | postgres | mysql`. Multi-tenancy is handled via LibSQL namespace (subdomain) or schema prefix (Postgres/MySQL) — see [plugin-database](../apps/plugin-database.md#query-flow-libsql).
- **File-backed only where the session/process requires it.** The only critical file-backed store is the runtime API keys store, precisely because it must exist before any plugin is loaded (admin/CLI bootstrap).
- **Persistent filesystem = PVC.** In the Helm chart, `/data/apps` and `/data/plugins` are mounted as separate PVCs; losing either results in a runtime with no apps or no custom plugins.

## Known Stores

| Store | Backend | Owner | Path / URL | Contents |
|-------|---------|-------|------------|----------|
| **plugin-keyval** | LibSQL (default) or SQLite/Postgres/MySQL via adapter | `@buntime/plugin-keyval` | `kv_entries` table in the database selected by `database` (see [keyval-tables](./keyval-tables.md)) | Generic KV (composite keys, TTL, versionstamps); foundation for all "dynamic state" in other plugins |
| **plugin-keyval queues** | LibSQL (same database) | `@buntime/plugin-keyval` | `kv_queue` + `kv_dlq` tables | FIFO queues with locking, retry/backoff, DLQ |
| **plugin-keyval FTS** | LibSQL FTS5 (same database) | `@buntime/plugin-keyval` | `kv_indexes` table + FTS5 virtual tables (`kv_fts_<prefix>`) | Full-text indexes per prefix |
| **plugin-keyval metrics** | LibSQL (same database; optional) | `@buntime/plugin-keyval` | `kv_metrics` table when `metrics.persistent: true` | `operations`/`errors`/`latency_sum` counters |
| **plugin-proxy rules** | LibSQL via plugin-keyval | `@buntime/plugin-proxy` | KV prefix `["proxy", "rules"]` (on top of `kv_entries`) | Dynamic redirect/proxy rules (static rules live in `manifest.yaml`) |
| **plugin-deployments** | LibSQL (own adapter) | `@buntime/plugin-deployments` | Own tables (see [plugin-deployments](../apps/plugin-deployments.md)) | Deploy history, releases |
| **plugin-vhosts** | LibSQL via plugin-keyval | `@buntime/plugin-vhosts` | Dedicated KV prefix | Dynamic host → app/plugin mappings |
| **plugin-authn / plugin-authz** | LibSQL | `@buntime/plugin-authn`, `@buntime/plugin-authz` | Own tables (see [plugin-authn](../apps/plugin-authn.md), [plugin-authz](../apps/plugin-authz.md)) | Sessions, users, policies |
| **API keys file store** | JSON on disk | `@buntime/runtime` | `${RUNTIME_STATE_DIR}/api-keys.json` or first `pluginDir` + `.buntime/api-keys.json` (Helm: `/data/plugins/.buntime/api-keys.json`) | SHA-256 hashed keys + role + permissions; bootstraps admin before any plugin is available |
| **Worker config cache** | In-memory (configurable TTL) | `@buntime/runtime` worker pool | Runtime process RAM | Worker manifest + config; avoids re-reading `app.yaml` on every request |
| **Worker resolver cache** | In-memory (configurable TTL) | `@buntime/runtime` worker pool | Runtime process RAM | App directory resolution (which `workerDir` contains `name@version`) |
| **Apps filesystem (PVC)** | Filesystem | Runtime + CLI/cpanel `app install` | `/data/apps` (Helm; `workerDirs: /data/.apps:/data/apps`) | Uploaded app bundles (workers): `dist/`, `app.yaml`, assets |
| **Plugins filesystem (PVC)** | Filesystem | Runtime + CLI/cpanel `plugin install` | `/data/plugins` (Helm; `pluginDirs: /data/.plugins:/data/plugins`) | Uploaded plugins (read-only built-ins stay at `/data/.plugins` from image; writable uploads stay at `/data/plugins`) |

> Paths `/data/.apps` and `/data/.plugins` (with dot) are **read-only**, baked into the Docker image. `/data/apps` and `/data/plugins` (without dot) are **mutable PVCs**. In local development, directories inside the Buntime project are also treated as built-in; uploads must go to a separate directory outside the project. See `charts/values.yaml`.

## Operational Details

### LibSQL as Default

Each plugin that requires persistence obtains the root adapter with:

```ts
const db = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
const adapter = db.getRootAdapter(config.database); // libsql | sqlite | postgres | mysql
```

`config.database` is optional — when absent, the `plugin-database` default adapter is used. In production (Helm), the default is **`libsql`** pointing to an embedded LibSQL server or a sidecar (`charts/libsql/`). Schema + indexes are created in each plugin's `onInit` (see `initSchema` in plugin-keyval).

### API Keys File Store

Unlike the other stores, this is a JSON file on disk because it must work **before** plugins are loaded (the runtime master key must authenticate `app install` and `plugin install` before a usable database is available).

| Aspect | Value |
|--------|-------|
| Format | JSON array of `{ id, name, keyPrefix, hash, role, permissions, createdAt }` objects |
| Hash | SHA-256 of the full secret |
| Path | `${RUNTIME_STATE_DIR}/api-keys.json` when set; otherwise first `pluginDir` + `.buntime/api-keys.json` |
| Helm path | `/data/plugins/.buntime/api-keys.json` (mutable PVC) |
| Granularity | Roles `admin` / `editor` / `viewer` / `custom` (see [runtime](../apps/runtime.md)) |
| Master key | `RUNTIME_MASTER_KEY` env var (Helm Secret `buntime.masterKey`); bypasses CSRF and plugin hooks; does **not** live in the JSON |

### Worker Pool In-Memory Caches

These are not "stores" in the durable sense — they vanish on restart. But they govern production behavior and are **tunable** via env vars:

| Cache | Env var | Default | When to disable |
|-------|---------|---------|-----------------|
| Worker config cache | `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` ms | Mutable apps in dev (set to `0`) |
| Worker resolver cache | `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` ms | Apps being (re)installed in a loop |
| Ephemeral concurrency | `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Not a cache, but affects `ttl: 0` workers — see [performance](../ops/performance.md) |
| Ephemeral queue limit | `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Excess requests receive `503` |

Cache TTL `0` = always re-read from disk, useful in dev. In production, the default `1000 ms` absorbs spikes without holding stale data for long.

### Filesystem in Production

| Volume | Mount | Source | RW |
|--------|-------|--------|----|
| `/data/apps` | `workerDirs` (second) | PVC | RW |
| `/data/.apps` | `workerDirs` (first) | Docker image | RO |
| `/data/plugins` | `pluginDirs` (second) | PVC | RW |
| `/data/.plugins` | `pluginDirs` (first) | Docker image | RO |
| `/data/plugins/.buntime/api-keys.json` | API key store | PVC | RW |

> In a local environment without Helm (`bun dev`), the runtime creates stores under `./data/` by default; set `RUNTIME_STATE_DIR` to a different path to isolate them.

## Dev → Prod Mapping

When the same code runs locally (without Helm) and on Rancher/k3s, store paths differ — useful for understanding why `bun dev` sees different state than the pod.

| Concept | Local dev (`bun dev`) | Helm (Rancher/k3s) |
|---------|-----------------------|--------------------|
| External plugins (RW) | `./plugins/` or `RUNTIME_PLUGIN_DIRS` | `/data/plugins` (PVC) |
| Core plugins (RO) | Repository (`packages/plugin-*` or bundle) | `/data/.plugins` (image) |
| Apps (RW) | `./apps-data/` or `RUNTIME_WORKER_DIRS` | `/data/apps` (PVC) |
| Embedded apps (RO) | — | `/data/.apps` (image, rarely used) |
| API keys store | `./.buntime/api-keys.json` or `${RUNTIME_STATE_DIR}/api-keys.json` | `/data/plugins/.buntime/api-keys.json` |
| LibSQL | Local embedded SQLite or ad-hoc container | Sidecar/Deployment (`charts/libsql/`) |

See `charts/values.base.yaml` (`runtime.pluginDirs`, `runtime.workerDirs`) for the canonical source of production paths. See [helm-charts](../ops/helm-charts.md) for the PVCs.

## Backup and Durability

Priority order for DR planning:

1. **LibSQL (`/data/libsql/` or sidecar volume).** Holds the state of all persistent plugins. Back up via volume snapshot **or** HRANA export — see [plugin-database](../apps/plugin-database.md).
2. **`/data/plugins/.buntime/api-keys.json`.** Without this, admin/CLI loses access. In multi-pod setups, `RUNTIME_STATE_DIR` must point to a shared volume (ReadWriteMany) — otherwise each pod maintains its own JSON and the result is non-deterministic.
3. **`/data/apps` and `/data/plugins`.** Can be reconstructed via `app install` / `plugin install` if a registry/artifact is available; without one, loss means recreating from scratch.
4. **In-memory caches.** No backup needed — they rebuild on demand.

> The bundled LibSQL sidecar (chart `charts/libsql/`) supports a single primary with replicas; multi-tenancy sits in a single database with per-subdomain namespacing. Postgres/MySQL remain viable but are not the default — compare in [plugin-database](../apps/plugin-database.md).

## Cross-References

- [plugin-database](../apps/plugin-database.md) — adapters, multi-tenancy, HRANA proxy.
- [plugin-keyval](../apps/plugin-keyval.md) — KV semantics (versionstamps, atomic, queues, FTS).
- [keyval-tables](./keyval-tables.md) — LibSQL table schema.
- [runtime](../apps/runtime.md) — `/api/keys/*` endpoints, roles, permissions, master key.
- [performance](../ops/performance.md) — tuning the in-memory caches.
