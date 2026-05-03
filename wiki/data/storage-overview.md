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
  - https://docs.turso.tech/tursodb/concurrent-writes
  - https://docs.turso.tech/sdk/ts/reference
  - https://docs.turso.tech/sync/usage
  - https://docs.turso.tech/sync/local-sync-server
  - wiki/apps/plugin-turso.md
  - https://bun.sh/docs/runtime/sqlite
  - https://www.sqlite.org/wal.html
  - .agents/rules/architecture.md
updated: 2026-05-02
tags: [data, storage, turso, legacy-libsql, file-store]
status: stable
---

# Buntime Storage Overview

> Canonical inventory of **where** the runtime and plugins persist data. The target architecture has [`@buntime/plugin-turso`](../apps/plugin-turso.md) as the durable SQL provider backed by Turso Database. Current code still contains legacy LibSQL/SQLite/Postgres/MySQL adapter references; treat those as legacy implementation details until the migration is complete. The runtime Helm chart now exposes generated `plugins.turso.*` values instead of `plugins.database.libsql*`. The filesystem (with PVCs in Helm) carries code (apps + plugins) and a single file-backed store (API keys). For detailed KeyVal schema, see [keyval-tables](./keyval-tables.md).

## Principles

- **Turso-only durable SQL target.** Buntime should converge on Turso Database as the only durable SQL driver. LibSQL, SQLite, Postgres, and MySQL references describe the current/legacy adapter abstraction, not the desired long-term surface.
- **Turso for concurrent writable plugin state.** Operational plugin state that can receive concurrent admin/API writes should use the Turso Database engine, not `bun:sqlite`, because Turso supports MVCC and `BEGIN CONCURRENT`. `bun:sqlite` is excellent for fast local SQLite access and WAL improves concurrent readers, but SQLite WAL still allows only one writer at a time.
- **Shared Turso provider for durable SQL.** Plugins that need durable SQL should depend on `@buntime/plugin-turso`, not on `@buntime/plugin-database` or `@buntime/plugin-keyval`. The consumer plugin owns its schema and migrations, while `plugin-turso` owns connection, sync, MVCC setup, and retry policy.
- **Gateway/proxy must not depend on KeyVal, and KeyVal must not depend on Database.** `plugin-gateway`, `plugin-proxy`, and `plugin-keyval` should use `@buntime/plugin-turso` directly for their durable storage. This keeps gateway/proxy independently enableable and keeps KeyVal as a KV feature plugin, not as mandatory infrastructure for unrelated edge plugins.
- **Kubernetes target = Turso Sync.** Local Turso database files are acceptable for local tests and single-pod deployments. Kubernetes deployments must be designed around Turso Sync so each pod owns its local database file and synchronizes with a remote sync server instead of sharing the same database file through a RWX volume.
- **Plugin Database is legacy, not the Turso target.** `plugin-database` remains a historical multi-adapter compatibility surface. New durable SQL work goes through `@buntime/plugin-turso`; do not turn `plugin-database` into the Turso provider.
- **No new multi-adapter work.** Do not expand the existing adapter abstraction. Future integrations can be reconsidered later, but the runtime migration target is one durable SQL driver: Turso.
- **File-backed only where the session/process requires it.** The only critical file-backed store is the runtime API keys store, precisely because it must exist before any plugin is loaded (admin/CLI bootstrap).
- **Persistent filesystem = PVC.** In the Helm chart, `/data/apps` and `/data/plugins` are mounted as separate PVCs; losing either results in a runtime with no apps or no custom plugins.

## Known Stores

| Store | Backend | Owner | Path / URL | Contents |
|-------|---------|-------|------------|----------|
| **plugin-turso** | Turso Database local/sync provider | `@buntime/plugin-turso` | Local DB path plus optional sync URL/token | Shared connection/sync lifecycle for durable SQL consumers |
| **plugin-keyval** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_entries` and related `kv_*` tables through `plugin-turso` (see [keyval-tables](./keyval-tables.md)) | Generic KV (composite keys, TTL, versionstamps); optional service for consumers that explicitly need KV |
| **plugin-keyval queues** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_queue` + `kv_dlq` tables | FIFO queues with locking, retry/backoff, DLQ |
| **plugin-keyval search** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_indexes` table + regular search tables (`kv_fts_<prefix>`) | Search indexes per prefix |
| **plugin-keyval metrics** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_metrics` table when `metrics.persistent: true` | `operations`/`errors`/`latency_sum` counters |
| **plugin-gateway operational state** | `@buntime/plugin-turso` when available | `@buntime/plugin-gateway` | `gateway_metrics_history` and `gateway_shell_excludes` tables owned by the plugin | Metrics history and dynamic shell excludes. Gateway keeps working without durable state when Turso is disabled |
| **plugin-proxy rules** | `@buntime/plugin-turso` | `@buntime/plugin-proxy` | `proxy_rules` table owned by the plugin | Dynamic redirect/proxy rules (static rules live in `manifest.yaml`). Proxy keeps static rules available when Turso is disabled |
| **plugin-deployments** | Current: own adapter. Target: Turso only | `@buntime/plugin-deployments` | Own tables (see [plugin-deployments](../apps/plugin-deployments.md)) | Deploy history, releases |
| **plugin-vhosts** | Current: plugin-keyval. Target: Turso-backed storage | `@buntime/plugin-vhosts` | Dedicated KV prefix | Dynamic host → app/plugin mappings |
| **plugin-authn / plugin-authz** | Current: plugin-database adapter. Target: Turso only | `@buntime/plugin-authn`, `@buntime/plugin-authz` | Own tables (see [plugin-authn](../apps/plugin-authn.md), [plugin-authz](../apps/plugin-authz.md)) | Sessions, users, policies |
| **API keys file store** | JSON on disk | `@buntime/runtime` | `${RUNTIME_STATE_DIR}/api-keys.json` or first `pluginDir` + `.buntime/api-keys.json` (Helm: `/data/plugins/.buntime/api-keys.json`) | SHA-256 hashed keys + role + permissions; bootstraps admin before any plugin is available |
| **Worker config cache** | In-memory (configurable TTL) | `@buntime/runtime` worker pool | Runtime process RAM | Worker manifest + config; avoids re-reading `app.yaml` on every request |
| **Worker resolver cache** | In-memory (configurable TTL) | `@buntime/runtime` worker pool | Runtime process RAM | App directory resolution (which `workerDir` contains `name@version`) |
| **Apps filesystem (PVC)** | Filesystem | Runtime + CLI/cpanel `app install` | `/data/apps` (Helm; `workerDirs: /data/.apps:/data/apps`) | Uploaded app bundles (workers): `dist/`, `app.yaml`, assets |
| **Plugins filesystem (PVC)** | Filesystem | Runtime + CLI/cpanel `plugin install` | `/data/plugins` (Helm; `pluginDirs: /data/.plugins:/data/plugins`) | Uploaded plugins (read-only built-ins stay at `/data/.plugins` from image; writable uploads stay at `/data/plugins`) |

> Paths `/data/.apps` and `/data/.plugins` (with dot) are **read-only**, baked into the Docker image. `/data/apps` and `/data/plugins` (without dot) are **mutable PVCs**. In local development, directories inside the Buntime project are also treated as built-in; uploads must go to a separate directory outside the project. See `charts/values.yaml`.

## Operational Details

### plugin-turso Provider Decision

As of 2026-05-02, `@buntime/plugin-keyval` has migrated away from `@buntime/plugin-database` and now depends on `@buntime/plugin-turso`. `@buntime/plugin-gateway` now uses `@buntime/plugin-turso` directly for `gateway_*` tables. `@buntime/plugin-proxy` now uses `@buntime/plugin-turso` directly for `proxy_rules`.

The target provider is `@buntime/plugin-turso`: a core infrastructure plugin that centralizes Turso connection setup, sync lifecycle, MVCC setup, and write-conflict retry helpers. Consumers still own their tables and schema boundaries:

| Consumer | Owns | Uses `plugin-turso` for |
|----------|------|--------------------------|
| `plugin-keyval` | `kv_*` schema and KV semantics | Durable SQL connection, local/sync mode, transaction/retry helpers |
| `plugin-gateway` | `gateway_*` schema for metrics history and dynamic shell excludes | Durable SQL connection, local/sync mode, transaction/retry helpers |
| `plugin-proxy` | `proxy_rules` schema for dynamic rules | Durable SQL connection, local/sync mode, transaction/retry helpers |

The reason is lifecycle independence: operators must be able to enable gateway/proxy while disabling database/keyval plugins in smaller or specialized environments. `plugin-turso` is not a user-facing Database/KV feature; it is the shared durable SQL provider.

The recommended provider modes are Turso-only:

| Mode | Durability | Use case |
|------|------------|----------|
| `local` | Durable local file | Local tests and single-pod deployments |
| `sync` | Durable local file plus remote synchronization | Kubernetes and any deployment with multiple pods or restart/relocation risk |
| `remote` | Remote SQL over HTTP | Future optional mode only if it adds value without reintroducing the legacy `@libsql/client` surface |

Turso is preferred over `bun:sqlite` for the durable driver because Turso Database supports MVCC and `BEGIN CONCURRENT`, allowing multiple writers to proceed in parallel with conflict retry. By contrast, Bun's built-in SQLite driver wraps SQLite; SQLite WAL is good for many concurrent readers plus one writer, but it still serializes writers.

Do not mount one shared database file into multiple pods. Turso concurrent writes solve engine-level writer concurrency; Kubernetes still adds filesystem and lock semantics that depend on the storage backend. For Kubernetes, each pod should have its own local database file and sync through Turso Sync.

For self-hosted Kubernetes, `sync` and `remote` both require a Turso endpoint. That endpoint can be external Turso Cloud, or an in-cluster Turso pod/service. In the Buntime chart family, the in-cluster option should replace the legacy LibSQL chart rather than extend it.

Implementation guidance:

- Declare `@buntime/plugin-turso` as the storage dependency for `plugin-keyval`, `plugin-gateway`, and `plugin-proxy` when their durable paths are migrated.
- Keep `plugin-gateway` and `plugin-proxy` manifests free of KeyVal/Database dependencies for their own state. Both edge consumers have completed this direct Turso migration.
- Keep domain APIs inside each consumer plugin. `plugin-turso` should expose database/transaction/sync primitives, not proxy/gateway/keyval business APIs.
- Retry Turso write conflicts around `BEGIN CONCURRENT` transactions.
- Treat `@libsql/client` legacy remote access separately from the Turso Database engine. The Turso TypeScript reference marks concurrent writes as supported for `@tursodatabase/database` and `@tursodatabase/sync`, planned for `@tursodatabase/serverless`, and unsupported for `@libsql/client`.

### Turso-only SQL Direction

The migration target is not "Turso plus optional adapters". It is a smaller runtime surface with Turso as the only durable SQL driver.

Implications:

- `plugin-database` multi-adapter support (`libsql`, `sqlite`, `postgres`, `mysql`) is a legacy/current implementation surface, not the future Turso provider.
- `@buntime/plugin-turso` is the target provider for new durable SQL consumers.
- New code should not add adapter-specific branching unless it is part of the Turso migration.
- Package exports such as `@buntime/database/sqlite`, `/postgres`, and `/mysql` should be considered migration candidates, not stable long-term APIs.
- Helm/env values such as `DATABASE_LIBSQL_URL` describe the current deployment wiring and should be replaced by Turso-oriented names during migration.

### Legacy Database Plugin Consumers

Each plugin that requires persistence obtains the root adapter with:

```ts
const db = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
const adapter = db.getRootAdapter(config.database); // libsql | sqlite | postgres | mysql
```

`config.database` is optional — when absent, the `plugin-database` default adapter is used. In production (Helm), the default is **`libsql`** pointing to an embedded LibSQL server or a sidecar (`charts/libsql/`). This is legacy context for remaining `plugin-database` consumers; KeyVal has already moved to `plugin-turso`.

This is the current/legacy pattern. Do not use it as a model for new storage work. Infrastructure plugins that should be independently enableable should own their schema and use `@buntime/plugin-turso` for durable SQL access.

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
| SQL driver | Current target: Turso Database through `@buntime/plugin-turso` | Runtime chart exposes `plugins.turso.*`; Kubernetes should use Turso Sync rather than a shared DB file |

See `charts/values.base.yaml` (`runtime.pluginDirs`, `runtime.workerDirs`) for the canonical source of production paths. See [helm-charts](../ops/helm-charts.md) for the PVCs.

## Backup and Durability

Priority order for DR planning:

1. **SQL state.** Current deployments use `/data/libsql/` or a sidecar volume. Target deployments should use Turso Database as the only durable SQL driver. Back up via the Turso-compatible mechanism selected during migration.
2. **`/data/plugins/.buntime/api-keys.json`.** Without this, admin/CLI loses access. In multi-pod setups, `RUNTIME_STATE_DIR` must point to a shared volume (ReadWriteMany) — otherwise each pod maintains its own JSON and the result is non-deterministic.
3. **`/data/apps` and `/data/plugins`.** Can be reconstructed via `app install` / `plugin install` if a registry/artifact is available; without one, loss means recreating from scratch.
4. **In-memory caches.** No backup needed — they rebuild on demand.

> The bundled LibSQL sidecar (chart `charts/libsql/`) is current deployment wiring, not the target architecture. The target is Turso-only. Postgres/MySQL and local SQLite can be reconsidered later as separate integrations, but they are not part of the runtime's durable SQL baseline.

## Cross-References

- [plugin-database](../apps/plugin-database.md) — adapters, multi-tenancy, HRANA proxy.
- [plugin-turso](../apps/plugin-turso.md) — target Turso Database provider for durable SQL.
- [plugin-keyval](../apps/plugin-keyval.md) — KV semantics (versionstamps, atomic, queues, FTS).
- [keyval-tables](./keyval-tables.md) — LibSQL table schema.
- [runtime](../apps/runtime.md) — `/api/keys/*` endpoints, roles, permissions, master key.
- [performance](../ops/performance.md) — tuning the in-memory caches.
