---
title: "KV Table Schema (LibSQL)"
audience: dev
sources:
  - plugins/plugin-keyval/server/lib/schema.ts
  - plugins/plugin-keyval/server/services.ts
  - plugins/plugin-proxy/server/services.ts
updated: 2026-05-02
tags: [data, libsql, keyval, tables]
status: stable
---

# KV Table Schema (LibSQL)

> **Schema reference** for the tables that `@buntime/plugin-keyval` creates in the selected adapter, and how other plugins (notably `plugin-proxy`) reuse the same storage. Behavior, REST API, and operation semantics live in [plugin-keyval](../apps/plugin-keyval.md) — this page focuses on DDL and encoding.

## Initialization

`initSchema(adapter)` is called in the plugin's `onInit` (`plugins/plugin-keyval/server/lib/schema.ts`) as a single `adapter.batch([...])`, creating six tables plus auxiliary indexes. All use `CREATE TABLE IF NOT EXISTS`, so restarts are idempotent. The adapter is whatever `plugin-database` returns from `getRootAdapter(config.database)`.

| Table | Purpose | Persistent | Notes |
|-------|---------|------------|-------|
| `kv_entries` | KV entries (key/value/versionstamp/expires_at) | Always | Core of the store |
| `kv_queue` | Active FIFO queue (pending/processing) | Always | Locked by `locked_until` |
| `kv_dlq` | Dead-letter queue | Always | No automatic cleanup |
| `kv_metrics` | Aggregated counters | When `metrics.persistent: true` | Periodic flush |
| `kv_indexes` | FTS index metadata | Whenever FTS is present | FTS5 virtual tables created on demand |
| `kv_fts_<prefix>` (virtual) | Per-prefix FTS5 index | When `POST /api/indexes` is called | Dynamic schema (fields come from the request) |

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

## kv_indexes + FTS5 Virtual Tables

```sql
CREATE TABLE IF NOT EXISTS kv_indexes (
  prefix BLOB PRIMARY KEY,
  fields TEXT NOT NULL,
  tokenize TEXT DEFAULT 'unicode61',
  created_at INTEGER NOT NULL
);
```

Each row in `kv_indexes` corresponds to **one** FTS5 virtual table created dynamically when the user calls `POST /api/indexes`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS kv_fts_<hash-of-prefix>
USING fts5(<field1>, <field2>, ..., tokenize='<tokenize>');
```

Triggers on `kv_entries` (see `server/tests/triggers.test.ts`) synchronize INSERT/UPDATE/DELETE from the base table into the corresponding FTS table whenever the key falls under the prefix. Synchronization is automatic for `set`/`delete`/atomic — no manual reindex is needed unless the index is recreated.

| Tokenizer | SQLite Implementation |
|-----------|-----------------------|
| `unicode61` | Default tokenizer (multilingual) |
| `porter` | English stemming |
| `ascii` | Plain ASCII |

## plugin-proxy: Dynamic Rules

`plugin-proxy` **does not create its own tables**. It consumes `Kv` via `ctx.getPlugin<Kv>("@buntime/plugin-keyval")` and stores each rule as a `kv_entries` entry under the prefix:

```ts
const KV_PREFIX = ["proxy", "rules"];
// services.ts:133
```

Operations:

| plugin-proxy operation | KV call | Row in `kv_entries` |
|------------------------|---------|----------------------|
| `listRules()` (dynamic) | `kv.list(["proxy", "rules"])` | Iterates all keys under this prefix |
| `addRule(rule)` / `updateRule` | `kv.set(["proxy","rules", rule.id], rule)` | Insert/update of the row |
| `deleteRule(id)` | `kv.delete(["proxy","rules", id])` | Delete by exact key |

`rule.id` is generated as `kv-<random>` when not provided. Static rules live in `manifest.yaml` and never touch KV (they receive `id="static-{index}"`). This is why the UI displays the type (`kv-…` vs `static-…`) and blocks deletion of static rules.

> The sequence `["proxy", "rules", "kv-abc"]` is encoded into a single BLOB following the encoding rules above — there is no separate `proxy_rules` table.

## Cross-References

- [plugin-keyval](../apps/plugin-keyval.md) — full semantics, REST API, atomic/queue/FTS.
- [plugin-database](../apps/plugin-database.md) — adapters, HRANA, LibSQL multi-tenancy.
- [plugin-proxy](../apps/plugin-proxy.md) — dynamic vs static rules, matching, WebSocket.
- [storage-overview](./storage-overview.md) — store inventory at the runtime level.
