---
title: "KV Table Schema"
audience: dev
sources:
  - plugins/plugin-keyval/server/lib/schema.ts
  - plugins/plugin-keyval/server/services.ts
updated: 2026-05-02
tags: [data, turso, legacy-libsql, keyval, tables]
status: stable
---

# KV Table Schema

> **Current schema reference** for the tables that `@buntime/plugin-keyval` creates through `@buntime/plugin-turso`. Behavior, REST API, and operation semantics live in [plugin-keyval](../apps/plugin-keyval.md) — this page focuses on DDL and encoding.

## Initialization

`initSchema(adapter)` is called in the plugin's `onInit` (`plugins/plugin-keyval/server/lib/schema.ts`) as a single `adapter.batch([...])`, creating six tables plus auxiliary indexes. All use `CREATE TABLE IF NOT EXISTS`, so restarts are idempotent. The adapter is `TursoKeyValAdapter`, a KeyVal-owned compatibility layer over `TursoService`.

| Table | Purpose | Persistent | Notes |
|-------|---------|------------|-------|
| `kv_entries` | KV entries (key/value/versionstamp/expires_at) | Always | Core of the store |
| `kv_queue` | Active FIFO queue (pending/processing) | Always | Locked by `locked_until` |
| `kv_dlq` | Dead-letter queue | Always | No automatic cleanup |
| `kv_metrics` | Aggregated counters | When `metrics.persistent: true` | Periodic flush |
| `kv_indexes` | Search index metadata | Whenever search is present | Prefix, field list, tokenizer metadata |
| `kv_fts_<prefix>` | Per-prefix search table | When `POST /api/indexes` is called | Regular table with `doc_key` and normalized `document` text |

## kv_entries

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

The partial index `idx_kv_expires` is what makes TTL cleanup efficient without a full table scan.

> **Gotcha — manual edits**: both `key` and `value` are `BLOB`. If you edit `kv_entries` directly via `sqlite3` CLI or another tool, you **must** insert/update the value as a `BLOB` (`Uint8Array`), not as a `TEXT` string — the API serializes JSON values into bytes, and a string-typed value will fail decoding at read time. Prefer the plugin's HTTP/SDK API for any modification.

### Nested Key Encoding

`KvKey` values (arrays of `KvKeyPart`) are encoded into **a single BLOB** via binary encoding with type prefixes:

```
["users", "123"]              → BLOB(<str-tag>users<sep><str-tag>123)
["users", 42, "profile"]      → BLOB(<str-tag>users<sep><num-tag>42<sep><str-tag>profile)
```

This enables:

1. **Direct PRIMARY KEY** — no joins or auxiliary tables.
2. **Prefix range scans** — `WHERE key >= prefix AND key < prefix_upper_bound` orders lexicographically.
3. **Stable ordering** across types (numbers before strings, etc.).

The `where-to-sql.ts` function translates filters like `{ "field": { "$eq": "value" } }` into SQL using `json_extract(value, '$.field')` — column-level indexes only exist for `expires_at`.

## kv_queue

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

The two partial indexes cover the hot paths: dequeue (`status='pending' AND ready_at <= now`) and stale-lock cleanup (`status='processing' AND locked_until < now`).

## kv_dlq

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

The DLQ is append-only. `requeue` moves an entry back to `kv_queue` (with `status='pending'`); `delete`/`purge` removes it. Automatic cleanup does **not** exist — operators need their own job (see troubleshooting in [plugin-keyval](../apps/plugin-keyval.md#tests-and-troubleshooting)).

## kv_metrics

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

The table is always created (DDL in `initSchema`), but only populated when `metrics.persistent: true`. The flush cadence is controlled by `metrics.flushInterval` (default `30000` ms). For ephemeral deployments, leaving this `false` and exposing metrics via `/api/metrics` or `/api/metrics/prometheus` (in-memory) is sufficient.

## kv_indexes + Search Tables

```sql
CREATE TABLE IF NOT EXISTS kv_indexes (
  prefix BLOB PRIMARY KEY,
  fields TEXT NOT NULL,
  tokenize TEXT DEFAULT 'unicode61',
  created_at INTEGER NOT NULL
);
```

Each row in `kv_indexes` corresponds to **one** regular search table created dynamically when the user calls `POST /api/indexes`:

```sql
CREATE TABLE IF NOT EXISTS kv_fts_<hash-of-prefix> (
  doc_key TEXT PRIMARY KEY,
  document TEXT NOT NULL
);
```

The `document` column stores normalized text extracted from the configured fields. Synchronization is automatic for `set`/`delete`/atomic — no manual reindex is needed unless the index is recreated.

> Turso Database with MVCC rejects SQLite virtual tables, and the installed SDK also showed FTS5 module limitations. Do not recreate `kv_fts_*` as `CREATE VIRTUAL TABLE`; keep it as a regular KeyVal-owned table unless Turso support changes and tests prove the migration.

| Tokenizer | SQLite Implementation |
|-----------|-----------------------|
| `unicode61` | Default tokenizer (multilingual) |
| `porter` | English stemming |
| `ascii` | Plain ASCII |

## Former plugin-proxy Dynamic Rules

`plugin-proxy` no longer stores dynamic rules in KeyVal. The former prefix
`["proxy", "rules"]` has been replaced by the proxy-owned `proxy_rules` table
through [`plugin-turso`](../apps/plugin-turso.md).

Static rules still live in `manifest.yaml` and never touch KeyVal. Dynamic rules
now receive generated UUIDs and are documented in
[`plugin-proxy`](../apps/plugin-proxy.md).

## Cross-References

- [plugin-keyval](../apps/plugin-keyval.md) — full semantics, REST API, atomic/queue/FTS.
- [plugin-database](../apps/plugin-database.md) — adapters, HRANA, LibSQL multi-tenancy.
- [plugin-proxy](../apps/plugin-proxy.md) — dynamic vs static rules, matching, WebSocket.
- [storage-overview](./storage-overview.md) — store inventory at the runtime level.
