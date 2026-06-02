---
title: Storage
description: Where the Buntime runtime and plugins persist data — durable SQL via plugin-turso, KeyVal tables, file-backed stores, and in-memory caches.
sidebar:
  order: 5
---

Canonical inventory of **where** the runtime and plugins persist data. Durable
SQL is provided by [`@buntime/plugin-turso`](/plugins/turso/), backed by Turso
Database. The runtime Helm chart exposes generated `plugins.turso.*` values. The
filesystem (with PVCs in Helm) carries code (apps + plugins) and a single
file-backed store (API keys). The [KeyVal tables](#keyval-tables) section below
documents the schema that `@buntime/plugin-keyval` creates through `plugin-turso`.

## Principles

- **Turso-only durable SQL.** Buntime converges on Turso Database as the only
  durable SQL driver. Earlier LibSQL/SQLite/Postgres/MySQL adapter references
  are legacy implementation details slated for removal, not the desired
  long-term surface.
- **Turso for concurrent writable plugin state.** Operational plugin state that
  can receive concurrent admin/API writes uses the Turso Database engine, not
  `bun:sqlite`, because Turso supports MVCC and `BEGIN CONCURRENT`. `bun:sqlite`
  is excellent for fast local SQLite access and WAL improves concurrent readers,
  but SQLite WAL still allows only one writer at a time.
- **Shared Turso provider for durable SQL.** Plugins that need durable SQL
  depend on `@buntime/plugin-turso`. The consumer plugin owns its schema and
  migrations, while `plugin-turso` owns connection, sync, MVCC setup, and retry
  policy.
- **Gateway/proxy must not depend on KeyVal, and KeyVal must not depend on
  unrelated infrastructure.** `plugin-gateway`, `plugin-proxy`, and
  `plugin-keyval` each use `@buntime/plugin-turso` directly for their durable
  storage. This keeps gateway/proxy independently enableable and keeps KeyVal as
  a KV feature plugin, not as mandatory infrastructure for unrelated edge
  plugins.
- **Kubernetes target = Turso Sync.** Local Turso database files are acceptable
  for local tests and single-pod deployments. Kubernetes deployments are
  designed around Turso Sync so each pod owns its local database file and
  synchronizes with a remote sync server instead of sharing the same database
  file through a RWX volume.
- **No new multi-adapter work.** Do not expand any adapter abstraction. The
  runtime target is one durable SQL driver: Turso.
- **File-backed only where the session/process requires it.** The only critical
  file-backed store is the runtime API keys store, precisely because it must
  exist before any plugin is loaded (admin/CLI bootstrap).
- **Persistent filesystem = PVC.** In the Helm chart, `/data/apps` and
  `/data/plugins` are mounted as separate PVCs; losing either results in a
  runtime with no apps or no custom plugins.

## Known stores

| Store | Backend | Owner | Path / URL | Contents |
|-------|---------|-------|------------|----------|
| **plugin-turso** | Turso Database local/sync provider | `@buntime/plugin-turso` | Local DB path plus optional sync URL/token | Shared connection/sync lifecycle for durable SQL consumers |
| **plugin-keyval** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_entries` and related `kv_*` tables through `plugin-turso` (see [KeyVal tables](#keyval-tables)) | Generic KV (composite keys, TTL, versionstamps); optional service for consumers that explicitly need KV |
| **plugin-keyval queues** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_queue` + `kv_dlq` tables | FIFO queues with locking, retry/backoff, DLQ |
| **plugin-keyval search** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_indexes` table + regular search tables (`kv_fts_<prefix>`) | Search indexes per prefix |
| **plugin-keyval metrics** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | `kv_metrics` table when `metrics.persistent: true` | `operations`/`errors`/`latency_sum` counters |
| **plugin-gateway operational state** | `@buntime/plugin-turso` when available | `@buntime/plugin-gateway` | `gateway_metrics_history` and `gateway_shell_excludes` tables owned by the plugin | Metrics history and dynamic shell excludes. Gateway keeps working without durable state when Turso is disabled |
| **plugin-proxy rules** | `@buntime/plugin-turso` | `@buntime/plugin-proxy` | `proxy_rules` table owned by the plugin | Dynamic redirect/proxy rules (static rules live in `manifest.yaml`). Proxy keeps static rules available when Turso is disabled |
| **plugin-vhosts** | `@buntime/plugin-turso` | `@buntime/plugin-vhosts` | Plugin-owned storage | Dynamic host → app/plugin mappings |
| **API keys store** | Turso DB (`@tursodatabase/database` / `@tursodatabase/sync`) on disk | `@buntime/runtime` | `${RUNTIME_STATE_DIR}/api-keys.db` (Helm: `/data/state/api-keys.db` on a per-pod RWO PVC). `mode=local`: standalone file; `mode=sync`: embedded replica synced against a Turso server primary | SHA-256 hashed keys + role + permissions; bootstraps admin before any plugin is available; legacy JSON and `bun:sqlite` files migrated transparently |
| **Worker config cache** | In-memory (configurable TTL) | `@buntime/runtime` worker pool | Runtime process RAM | Worker manifest + config; avoids re-reading `app.yaml` on every request |
| **Worker resolver cache** | In-memory (configurable TTL) | `@buntime/runtime` worker pool | Runtime process RAM | App directory resolution (which `workerDir` contains `name@version`) |
| **Apps filesystem (PVC)** | Filesystem | Runtime + CLI/cpanel `app install` | `/data/apps` (Helm; `workerDirs: /data/.apps:/data/apps`) | Uploaded app bundles (workers): `dist/`, `app.yaml`, assets |
| **Plugins filesystem (PVC)** | Filesystem | Runtime + CLI/cpanel `plugin install` | `/data/plugins` (Helm; `pluginDirs: /data/.plugins:/data/plugins`) | Uploaded plugins (read-only built-ins stay at `/data/.plugins` from image; writable uploads stay at `/data/plugins`) |

:::note
Additional storage-backed plugins (deployment history, authentication
sessions, authorization policies) are planned. See the
[roadmap](/reference/roadmap/) for their status. When implemented, they will
own their own tables through `plugin-turso`.
:::

:::caution
Paths `/data/.apps` and `/data/.plugins` (with dot) are **read-only**, baked
into the Docker image. `/data/apps` and `/data/plugins` (without dot) are
**mutable PVCs**. In local development, directories inside the Buntime project
are also treated as built-in; uploads must go to a separate directory outside
the project. See `charts/values.yaml`.
:::

## Operational details

### plugin-turso provider

`@buntime/plugin-turso` is the durable SQL provider: a core infrastructure
plugin that centralizes Turso connection setup, sync lifecycle, MVCC setup, and
write-conflict retry helpers. Consumers own their tables and schema boundaries:

| Consumer | Owns | Uses `plugin-turso` for |
|----------|------|--------------------------|
| `plugin-keyval` | `kv_*` schema and KV semantics | Durable SQL connection, local/sync mode, transaction/retry helpers |
| `plugin-gateway` | `gateway_*` schema for metrics history and dynamic shell excludes | Durable SQL connection, local/sync mode, transaction/retry helpers |
| `plugin-proxy` | `proxy_rules` schema for dynamic rules | Durable SQL connection, local/sync mode, transaction/retry helpers |

The reason is lifecycle independence: operators must be able to enable
gateway/proxy while disabling the KeyVal plugin in smaller or specialized
environments. `plugin-turso` is not a user-facing feature plugin; it is the
shared durable SQL provider. Consumers obtain it through the standard
service-sharing API — the provider exposes a service via `provides`, and
consumers retrieve it with `ctx.getPlugin<TursoService>("@buntime/plugin-turso")`.

The recommended provider modes are Turso-only:

| Mode | Durability | Use case |
|------|------------|----------|
| `local` | Durable local file | Local tests and single-pod deployments |
| `sync` | Durable local file plus remote synchronization | Kubernetes and any deployment with multiple pods or restart/relocation risk |
| `remote` | Remote SQL over HTTP | Future optional mode only if it adds value |

Turso is preferred over `bun:sqlite` for the durable driver because Turso
Database supports MVCC and `BEGIN CONCURRENT`, allowing multiple writers to
proceed in parallel with conflict retry. By contrast, Bun's built-in SQLite
driver wraps SQLite; SQLite WAL is good for many concurrent readers plus one
writer, but it still serializes writers.

Do not mount one shared database file into multiple pods. Turso concurrent
writes solve engine-level writer concurrency; Kubernetes still adds filesystem
and lock semantics that depend on the storage backend. For Kubernetes, each pod
should have its own local database file and sync through Turso Sync.

For self-hosted Kubernetes, `sync` and `remote` both require a Turso endpoint.
That endpoint can be external Turso Cloud, or an in-cluster Turso pod/service.

Implementation guidance:

- Declare `@buntime/plugin-turso` as the storage dependency for `plugin-keyval`,
  `plugin-gateway`, and `plugin-proxy`.
- Keep `plugin-gateway` and `plugin-proxy` manifests free of KeyVal dependencies
  for their own state. Both edge consumers use Turso directly.
- Keep domain APIs inside each consumer plugin. `plugin-turso` exposes
  database/transaction/sync primitives, not proxy/gateway/keyval business APIs.
- Retry Turso write conflicts around `BEGIN CONCURRENT` transactions.

### API keys store

The `ApiKeyStore` is **not** a plugin-backed store, because it must work
**before** any plugin is loaded — the runtime root key authenticates
`worker install` / `plugin install` before any plugin (including
plugin-turso) is even loaded. It must remain self-contained at bootstrap.

Backend: **Turso DB** (via `@tursodatabase/database` for local mode and
`@tursodatabase/sync` for embedded-replica/multi-pod mode). Turso DB files
are binarily SQLite-compatible — any pre-existing `.db` (from earlier
`bun:sqlite` or `libsql` deployments) opens transparently.

Schema: a single `api_keys` table with two partial indices
(`idx_api_keys_lookup` on `key_hash` and `idx_api_keys_expiry` on
`expires_at`, both `WHERE revoked_at IS NULL`). Permissions are JSON-encoded.

| Aspect | Value |
|--------|-------|
| Backend | Turso DB (Rust, MVCC journal). Drivers: `@tursodatabase/database` (local), `@tursodatabase/sync` (embedded replica). |
| Modes | `local` (standalone file, single-pod, default). `sync` (embedded replica synced with a Turso server primary, multi-pod). |
| Hash | SHA-256 of the full secret |
| Path | `${RUNTIME_STATE_DIR}/api-keys.db` (Helm: `/data/state/api-keys.db` on a per-pod RWO PVC via the StatefulSet's `volumeClaimTemplates`). |
| Granularity | Roles `admin` / `editor` / `viewer` / `custom` (see [the Runtime](/concepts/runtime/)) |
| Root key | `RUNTIME_ROOT_KEY` env var (Helm Secret `buntime.rootKey`); synthetic `root` principal; bypasses CSRF and plugin hooks; does **not** live in the DB. |
| Multi-pod | See [Multi-pod deployment](/ops/multi-pod/). When `tursoPrimary.enabled=true`, the chart provisions a Turso server primary StatefulSet and points the ApiKeyStore (and optionally plugin-turso) at it. |
| Legacy | Pre-2026-05-20 the store used JSON, then briefly `bun:sqlite`. Both are auto-migrated. JSON is renamed to `*.migrated` (defensive backup). |

### Worker pool in-memory caches

These are not "stores" in the durable sense — they vanish on restart. But they
govern production behavior and are **tunable** via env vars:

| Cache | Env var | Default | When to disable |
|-------|---------|---------|-----------------|
| Worker config cache | `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` ms | Mutable apps in dev (set to `0`) |
| Worker resolver cache | `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` ms | Apps being (re)installed in a loop |
| Ephemeral concurrency | `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Not a cache, but affects `ttl: 0` workers — see [performance](/ops/performance/) |
| Ephemeral queue limit | `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Excess requests receive `503` |

Cache TTL `0` = always re-read from disk, useful in dev. In production, the
default `1000 ms` absorbs spikes without holding stale data for long.

### Filesystem in production

| Volume | Mount | Source | RW |
|--------|-------|--------|----|
| `/data/apps` | `workerDirs` (second) | PVC | RW |
| `/data/.apps` | `workerDirs` (first) | Docker image | RO |
| `/data/plugins` | `pluginDirs` (second) | PVC | RW |
| `/data/.plugins` | `pluginDirs` (first) | Docker image | RO |
| `/data/state/api-keys.db` | API key store (Turso DB) | PVC | RW |

:::note
In a local environment without Helm (`bun dev`), the runtime creates stores
under `./data/` by default; set `RUNTIME_STATE_DIR` to a different path to
isolate them.
:::

## Dev → prod mapping

When the same code runs locally (without Helm) and on Rancher/k3s, store paths
differ — useful for understanding why `bun dev` sees different state than the
pod.

| Concept | Local dev (`bun dev`) | Helm (Rancher/k3s) |
|---------|-----------------------|--------------------|
| External plugins (RW) | `./plugins/` or `RUNTIME_PLUGIN_DIRS` | `/data/plugins` (PVC) |
| Core plugins (RO) | Repository (`packages/plugin-*` or bundle) | `/data/.plugins` (image) |
| Apps (RW) | `./apps-data/` or `RUNTIME_WORKER_DIRS` | `/data/apps` (PVC) |
| Embedded apps (RO) | — | `/data/.apps` (image, rarely used) |
| API keys store | `./.buntime/api-keys.db` or `${RUNTIME_STATE_DIR}/api-keys.db` | `/data/state/api-keys.db` |
| SQL driver | Turso Database through `@buntime/plugin-turso` | Runtime chart exposes `plugins.turso.*`; Kubernetes uses Turso Sync rather than a shared DB file |

See `charts/values.base.yaml` (`runtime.pluginDirs`, `runtime.workerDirs`) for
the canonical source of production paths. See
[Helm and Kubernetes](/ops/helm-kubernetes/) for the PVCs.

## Backup and durability

Priority order for DR planning:

1. **SQL state.** Durable SQL uses Turso Database via `@buntime/plugin-turso`.
   Back up via the Turso-compatible mechanism for your deployment (local file
   snapshot or Turso Sync server backup).
2. **`/data/state/api-keys.db`.** Without this, operator access is lost. In
   multi-pod setups, use `sync` mode (embedded replica against a Turso server
   primary) rather than sharing a single file across pods.
3. **`/data/apps` and `/data/plugins`.** Can be reconstructed via `app install`
   / `plugin install` if a registry/artifact is available; without one, loss
   means recreating from scratch.
4. **In-memory caches.** No backup needed — they rebuild on demand.

## KeyVal tables

This section is the **current schema reference** for the tables that
`@buntime/plugin-keyval` creates through `@buntime/plugin-turso`. Behavior, REST
API, and operation semantics live in [the KeyVal plugin](/plugins/keyval/) — this
section focuses on DDL and encoding.

### Initialization

`initSchema(adapter)` is called in the plugin's `onInit`
(`plugins/plugin-keyval/server/lib/schema.ts`) as a single `adapter.batch([...])`,
creating six tables plus auxiliary indexes. All use `CREATE TABLE IF NOT EXISTS`,
so restarts are idempotent. The adapter is `TursoKeyValAdapter`, a KeyVal-owned
compatibility layer over `TursoService`.

| Table | Purpose | Persistent | Notes |
|-------|---------|------------|-------|
| `kv_entries` | KV entries (key/value/versionstamp/expires_at) | Always | Core of the store |
| `kv_queue` | Active FIFO queue (pending/processing) | Always | Locked by `locked_until` |
| `kv_dlq` | Dead-letter queue | Always | No automatic cleanup |
| `kv_metrics` | Aggregated counters | When `metrics.persistent: true` | Periodic flush |
| `kv_indexes` | Search index metadata | Whenever search is present | Prefix, field list, tokenizer metadata |
| `kv_fts_<prefix>` | Per-prefix search table | When `POST /api/indexes` is called | Regular table with `doc_key` and normalized `document` text |

### kv_entries

```sql
CREATE TABLE IF NOT EXISTS kv_entries (
  key BLOB PRIMARY KEY,
  value BLOB NOT NULL,
  versionstamp TEXT NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kv_expires
  ON kv_entries(expires_at)
  WHERE expires_at IS NOT NULL;
```

| Column | Type | Contents |
|--------|------|----------|
| `key` | BLOB (PK) | Binary-encoded key with type prefix, ensuring lexicographic order `Uint8Array < string < number < bigint < boolean` |
| `value` | BLOB | Serialized value (typically JSON; may be binary) |
| `versionstamp` | TEXT | Monotonic hex — increments on every `set`/`atomic`. Basis for OCC |
| `expires_at` | INTEGER nullable | Unix epoch (s) when the entry expires; `NULL` = no TTL |

The partial index `idx_kv_expires` is what makes TTL cleanup efficient without a
full table scan.

:::caution[Manual edits]
Both `key` and `value` are `BLOB`. If you edit `kv_entries` directly via
`sqlite3` CLI or another tool, you **must** insert/update the value as a `BLOB`
(`Uint8Array`), not as a `TEXT` string — the API serializes JSON values into
bytes, and a string-typed value will fail decoding at read time. Prefer the
plugin's HTTP/SDK API for any modification.
:::

#### Nested key encoding

`KvKey` values (arrays of `KvKeyPart`) are encoded into **a single BLOB** via
binary encoding with type prefixes:

```
["users", "123"]              → BLOB(<str-tag>users<sep><str-tag>123)
["users", 42, "profile"]      → BLOB(<str-tag>users<sep><num-tag>42<sep><str-tag>profile)
```

This enables:

1. **Direct PRIMARY KEY** — no joins or auxiliary tables.
2. **Prefix range scans** — `WHERE key >= prefix AND key < prefix_upper_bound`
   orders lexicographically.
3. **Stable ordering** across types (numbers before strings, etc.).

The `where-to-sql.ts` function translates filters like
`{ "field": { "$eq": "value" } }` into SQL using `json_extract(value, '$.field')`
— column-level indexes only exist for `expires_at`.

### kv_queue

```sql
CREATE TABLE IF NOT EXISTS kv_queue (
  id TEXT PRIMARY KEY,
  value BLOB NOT NULL,
  ready_at INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  backoff_schedule TEXT,
  keys_if_undelivered TEXT,
  status TEXT DEFAULT 'pending',
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_ready
  ON kv_queue(status, ready_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_queue_locked
  ON kv_queue(locked_until) WHERE status = 'processing';
```

| Column | Contents |
|--------|----------|
| `id` | UUIDv7 of the message |
| `value` | Payload (BLOB / serialized JSON) |
| `ready_at` | When the message becomes available (supports `delay`) |
| `attempts` / `max_attempts` | Current count and ceiling (moves to DLQ when reached) |
| `backoff_schedule` | JSON array `[1000, 5000, 10000]` (ms) |
| `keys_if_undelivered` | JSON array of `KvKey[]` for DLQ fallback |
| `status` | `pending` \| `processing` |
| `locked_until` | Unix epoch (s) — when the dequeue lock expires |

The two partial indexes cover the hot paths: dequeue (`status='pending' AND
ready_at <= now`) and stale-lock cleanup (`status='processing' AND locked_until
< now`).

### kv_dlq

```sql
CREATE TABLE IF NOT EXISTS kv_dlq (
  id TEXT PRIMARY KEY,
  original_id TEXT NOT NULL,
  value BLOB NOT NULL,
  error_message TEXT,
  attempts INTEGER NOT NULL,
  original_created_at INTEGER NOT NULL,
  failed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON kv_dlq(failed_at);
```

The DLQ is append-only. `requeue` moves an entry back to `kv_queue` (with
`status='pending'`); `delete`/`purge` removes it. Automatic cleanup does **not**
exist — operators need their own job (see troubleshooting in
[the KeyVal plugin](/plugins/keyval/)).

### kv_metrics

```sql
CREATE TABLE IF NOT EXISTS kv_metrics (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  latency_sum REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_operation ON kv_metrics(operation);
```

The table is always created (DDL in `initSchema`), but only populated when
`metrics.persistent: true`. The flush cadence is controlled by
`metrics.flushInterval` (default `30000` ms). For ephemeral deployments, leaving
this `false` and exposing metrics via `/api/metrics` or
`/api/metrics/prometheus` (in-memory) is sufficient.

### kv_indexes + search tables

```sql
CREATE TABLE IF NOT EXISTS kv_indexes (
  prefix BLOB PRIMARY KEY,
  fields TEXT NOT NULL,
  tokenize TEXT DEFAULT 'unicode61',
  created_at INTEGER NOT NULL
);
```

Each row in `kv_indexes` corresponds to **one** regular search table created
dynamically when the user calls `POST /api/indexes`:

```sql
CREATE TABLE IF NOT EXISTS kv_fts_<hash-of-prefix> (
  doc_key TEXT PRIMARY KEY,
  document TEXT NOT NULL
);
```

The `document` column stores normalized text extracted from the configured
fields. Synchronization is automatic for `set`/`delete`/atomic — no manual
reindex is needed unless the index is recreated.

:::caution
Turso Database with MVCC rejects SQLite virtual tables, and the installed SDK
also showed FTS5 module limitations. Do not recreate `kv_fts_*` as `CREATE
VIRTUAL TABLE`; keep it as a regular KeyVal-owned table unless Turso support
changes and tests prove the migration.
:::

| Tokenizer | SQLite Implementation |
|-----------|-----------------------|
| `unicode61` | Default tokenizer (multilingual) |
| `porter` | English stemming |
| `ascii` | Plain ASCII |

### Former plugin-proxy dynamic rules

`plugin-proxy` no longer stores dynamic rules in KeyVal. The former prefix
`["proxy", "rules"]` has been replaced by the proxy-owned `proxy_rules` table
through [`plugin-turso`](/plugins/turso/).

Static rules still live in `manifest.yaml` and never touch KeyVal. Dynamic rules
now receive generated UUIDs and are documented in
[the Proxy plugin](/plugins/proxy/).

## Cross-references

- [plugin-turso](/plugins/turso/) — Turso Database provider for durable SQL.
- [plugin-keyval](/plugins/keyval/) — KV semantics (versionstamps, atomic, queues, FTS).
- [The Runtime](/concepts/runtime/) — `/api/keys/*` endpoints, roles, permissions, root key.
- [Performance](/ops/performance/) — tuning the in-memory caches.
- [Turso server](/ops/turso-server/) — running an in-cluster Turso sync server.
