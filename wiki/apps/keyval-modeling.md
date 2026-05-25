---
title: "@buntime/keyval — fundamentals and modeling"
audience: dev
sources:
  - packages/keyval/README.adoc
  - packages/keyval/docs/**
updated: 2026-05-02
tags: [keyval, deno-kv, modeling, patterns, versionstamp]
status: stable
---

# @buntime/keyval — fundamentals and modeling

> Conceptual documentation for the `@buntime/keyval` client library — Deno KV-like model, key design, concurrency control via versionstamp, multi-tenant modeling patterns. For the server plugin (REST API, SSE, configuration, troubleshooting), see [`./plugin-keyval.md`](./plugin-keyval.md). For the package exports table, see [`./packages.md`](./packages.md).

The library is an HTTP/SSE client — every modeling decision here is reflected as keys in the plugin's underlying SQL. None of the constructs below require server-side code: you only design keys and use the client-side `Kv`.

## Mindset (KV vs RDBMS)

The most important mental shift: **the key structure IS the index**. In SQL you declare indexes and the planner decides. In KeyVal, you materialize the index as another key and maintain the sync explicitly.

| Aspect | SQL | KeyVal |
|--------|-----|--------|
| Schema | Rigid (DDL + migration) | Implicit in the JSON value |
| Validation | In the database (constraints) | In the application (Zod, TypeBox) |
| Access | Declarative queries (WHERE, JOIN, GROUP BY) | Key/prefix access + manual indexes |
| Performance | Depends on planner and indexes | O(1) per key; predictable |
| JOINs | Native | N queries or denormalization |
| Aggregation | `COUNT`, `SUM`, `GROUP BY` | Pre-calculated counters (`sum`/`max`/`min`) |
| Real-time | Triggers + LISTEN/NOTIFY or polling | Built-in `watch()` |
| Sharding | Breaks cross-shard JOINs | Natural by prefix |

KeyVal works naturally with DDD aggregates: data that belongs together lives in the same prefix (`["orders", id]`, `["orders", id, "items"]`, …) and disappears together via `delete()` by prefix.

**Good for:** sessions, cache, configuration, queues, counters, hierarchical data, real-time, lightweight FTS.
**Avoid for:** complex ad-hoc queries, analytical reports, heavy aggregations, highly relational data — combine with PostgreSQL/ClickHouse for those cases.

## Key structure

A key is an **ordered array of parts**. The length and types define the hierarchy, ordering, and query granularity.

### Supported types

| Type | Example | Typical use | Limit per part |
|------|---------|-------------|----------------|
| `string` | `"users"`, `"usr_001"` | Namespaces, text IDs | 1024 chars |
| `number` | `123`, `2024` | Numeric IDs, years, scores | 8 bytes (IEEE 754) |
| `bigint` | `9007199254740993n` | Very large IDs | no fixed limit |
| `boolean` | `true`, `false` | Flags (rare) | 1 byte |
| `Uint8Array` | `new Uint8Array([1,2,3])` | Hashes, binary data | 1024 bytes |

Maximum depth: **20 parts** per key. Theoretical total size: ~20 KB in the worst case.

### Binary ordering (lexicographic order)

Keys are ordered lexicographically byte by byte. For cross-type ordering, the plugin encodes with a type prefix, guaranteeing `Uint8Array < string < number < bigint < boolean`.

Practical consequence: **numbers are not ordered numerically**.

```typescript
await kv.set(["items", 1], "first");
await kv.set(["items", 2], "second");
await kv.set(["items", 10], "tenth");

for await (const e of kv.list(["items"])) console.log(e.key[1]);
// 1, 10, 2  (lexicographic order, not numeric)
```

| Solution | When |
|----------|------|
| Zero-padded strings (`"0001"`) | Synthetic IDs under your control |
| ULID / UUIDv7 | Time-ordered, distributed IDs |
| Inverted timestamp (`MAX - now`) | Native descending order (newest first) without `reverse: true` |

### Hierarchies and prefix queries

```typescript
["users", userId]                                         // User
["users", userId, "profile"]                              // 1:1 sub-resource
["users", userId, "posts", postId]                        // 1:N sub-resource
["users", userId, "posts", postId, "comments", commentId] // Deeper nesting

for await (const e of kv.list(["users", userId, "posts"])) { /* ... */ }
await kv.delete(["users", userId]);  // cascading delete: removes everything
```

`delete(prefix)` is **prefix by default** — deletes the key and all descendants. Use `{ exact: true }` to delete only the exact key.

### Naming conventions

| Part | Convention | Good | Bad |
|------|------------|------|-----|
| Entity | Plural, snake_case | `users`, `blog_posts`, `order_items` | `user`, `blogPosts`, `USERS` |
| ID | UUID/ULID/UUIDv7 | `crypto.randomUUID()`, `Bun.randomUUIDv7()` | Sequential in distributed systems |
| 1:1 sub-resource | Singular | `profile`, `settings`, `shipping` | `profiles` |
| 1:N sub-resource | Plural | `posts`, `comments` | `post` |
| Index | `{entity}_by_{field}` | `users_by_email`, `posts_by_date` | `idx_users_1` |

### Anti-patterns

| Bad pattern | Why | Alternative |
|-------------|-----|-------------|
| `["org", o, "dept", d, "team", t, "member", u]` (>5 levels) | Hard to maintain, breaks on refactor | Separate entities with references |
| `["users", email]` (mutable field in key) | Changing email means recreating everything | `["users", id]` + `["users_by_email", email] → id` |
| `["users", "password123", id]` (sensitive data) | Keys appear in logs and errors | Sensitive data goes **in the value** |

## Versionstamp and concurrency control

Every entry has a `versionstamp` (UUIDv7-like) that changes with each modification. It is **unique, orderable, opaque** — you only compare it, never interpret it.

```typescript
const entry = await kv.get(["docs", id]);
// { key, value, versionstamp: "019234f0-1234-7abc-..." }
```

### Classic race condition (lost update)

```text
Time   Process A                 Process B
  1    Reads doc (vs1)
  2                              Reads doc (vs1)
  3    Modifies + saves
  4                              Modifies + saves   ← A's change is lost
```

### Optimistic Locking via `check()`

`atomic().check(entry)` validates that the key's versionstamp is still the expected one **at commit time**. If it changed, the commit fails (`{ ok: false }`) without applying anything.

```typescript
// Safe update
const entry = await kv.get<User>(["users", id]);
const result = await kv.atomic()
  .check(entry)
  .set(["users", id], { ...entry.value!, name: "New name" })
  .commit();
if (!result.ok) { /* conflict */ }

// Create-if-not-exists (versionstamp: null = "does not exist")
await kv.atomic()
  .check({ key: ["users_by_email", email], versionstamp: null })
  .set(["users", id], user)
  .set(["users_by_email", email], id)
  .commit();
```

### When to use versionstamp

| Use | Do not use |
|-----|------------|
| Read-modify-write (any read followed by write) | Idempotent operations (intentional overwrite) |
| Guaranteeing uniqueness on creation | Counters — prefer `sum()`, `max()`, `min()` |
| Updating with secondary indexes | Operations without a preceding read |

### Versionstamp vs timestamp

| Aspect | Versionstamp | `Date.now()` / `kv.now()` |
|--------|--------------|---------------------------|
| Generated by | Server (at commit) | Client / server |
| Uniqueness | Global, unique per transaction | Can collide under high concurrency |
| Use | Concurrency control | Business data (`createdAt`, `updatedAt`) |
| Clock skew | N/A | `kv.now()` avoids it; client `Date.now()` is subject to it |

> **Always use `kv.now()` in filters and expirations** — it is resolved on the server, avoiding clock skew.

## Operations (CRUD, atomic, listing, transactions)

Conceptual overview of the client API. For the corresponding REST API details (same semantics over HTTP), see [`./plugin-keyval.md`](./plugin-keyval.md).

### CRUD

| Method | Signature | Behavior |
|--------|-----------|----------|
| `get<T>(key)` | `KvEntry<T>` | `{ key, value, versionstamp }` or `{ value: null, versionstamp: null }` |
| `get<T>(keys[])` | `KvEntry<T>[]` | Batch — one request, same order |
| `set(key, value, opts?)` | `void` | Upsert; completely replaces the value; `expiresIn` for TTL |
| `delete(key, opts?)` | `void` | **Prefix by default**; `{ exact: true }` for a single key; `{ where: ... }` to filter |
| `count(prefix)` | `number` | Counts entries; O(n) without an index — for frequent use, maintain an atomic counter |

`set` is always upsert. To create only if absent, use `atomic().check({ key, versionstamp: null })`.

KeyVal has **no** native partial update — read-modify-write is the pattern. To do it safely, use `transaction()` (next section).

### Atomic operations

`atomic()` combines checks (expected versionstamps) and mutations in an all-or-nothing commit.

| Mutation | Behavior |
|----------|----------|
| `set(key, value, opts?)` | Sets value (with optional TTL) |
| `delete(key)` | Removes |
| `check(entry \| { key, versionstamp })` | Fails the commit if versionstamp diverges |
| `sum(key, n: bigint)` | Increments; missing key = 0; **bigint** |
| `max(key, n: bigint)` | `max(current, new)` — useful for highscores, peaks |
| `min(key, n: bigint)` | `min(current, new)` — useful for best times |
| `append(key, items[])` | Concatenates to array; creates if absent |
| `prepend(key, items[])` | Inserts at the start |

```typescript
// Create user with index and counter, guaranteeing email uniqueness
const result = await kv.atomic()
  .check({ key: ["users_by_email", user.email], versionstamp: null })
  .set(["users", id], user)
  .set(["users_by_email", user.email], id)
  .sum(["stats", "users", "total"], 1n)
  .commit();
if (!result.ok) throw new Error("Email already registered");
```

Result: `{ ok: true, versionstamp }` or `{ ok: false }`. A check failure does **not** throw — you must check `result.ok`.

Practical limit: ~1,000 operations per commit; recommended < 100. For larger volumes, partition into batches.

### Listing and pagination

| Method | Return | When to use |
|--------|--------|-------------|
| `list<T>(prefix, opts?)` | `AsyncIterator<KvEntry<T>>` | Streaming iteration, early exit, sequential processing |
| `paginate<T>(prefix, opts?)` | `{ entries, cursor, hasMore }` | Exposing a cursor to the client (REST, infinite scroll) |
| `search<T>(prefix, query, opts?)` | `AsyncIterator<KvEntry<T>>` | Full-text search via FTS |

`list` options: `limit`, `reverse`, `start`/`end` (range), `where` (server-side filter), `cursor`.

**Cursor vs offset.** Always prefer cursor: O(1) per page, consistent under insertions/deletions; offset re-reads and discards data.

**Server-side filtering via `where`.** Operators: comparison (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$between`), arrays (`$in`, `$nin`), case-sensitive strings (`$contains`, `$startsWith`, `$endsWith`, `$notContains`), case-insensitive strings (suffix `i`: `$containsi`, …), existence (`$null`, `$empty`, `$notEmpty`), logical (`$and`, `$or`, `$not`). Supports dot-notation (`"profile.verified"`) and array index (`"items[0].price"`).

```typescript
for await (const e of kv.list<User>(["users"], {
  where: {
    $and: [
      { age: { $gte: 18 } },
      { $or: [{ status: "active" }, { status: "pending" }] },
      { lastLogin: { $gt: kv.now() - 7 * 24 * 3600_000 } },
    ],
  },
})) { /* ... */ }
```

> `where` performs a scan + `json_extract`. For hot fields in large datasets, prefer **composite keys** (manual indexes).

### Transactions

`transaction(fn, opts?)` encapsulates read-modify-write with **automatic versionstamp checks** on reads and a **write buffer**. On conflict, it re-executes the function.

| Aspect | `atomic()` | `transaction()` |
|--------|-----------|-----------------|
| Versionstamp check | Manual (explicit `.check()`) | Automatic (every read via `tx.get` is checked) |
| Retry | Manual | Configurable via `maxRetries` (default `0`) |
| Reads | Outside the `atomic` | Inside the callback, cached |
| When to use | Operations without a preceding read (create, sum, max) | Read-modify-write with logic |

```typescript
const result = await kv.transaction(async (tx) => {
  const [from, to] = await tx.get<Account>([["accounts", a], ["accounts", b]]);
  if (!from.value || !to.value) throw new Error("Account not found");
  if (from.value.balance < amount) throw new Error("Insufficient balance");
  tx.set(["accounts", a], { ...from.value, balance: from.value.balance - amount });
  tx.set(["accounts", b], { ...to.value, balance: to.value.balance + amount });
}, { maxRetries: 5, retryDelay: "100ms" });
```

Linear backoff: `retryDelay * attempt` (50, 100, 150 ms…).

> **Known plugin limitation.** Despite the `maxRetries`/`retryDelay` fields, the server **does not** retry automatically in all builds — see the Limitations section in [`./plugin-keyval.md`](./plugin-keyval.md#limitations). Implement retry in the caller when critical.

**Best practices.** Keep transactions **short**; process iterations outside; ensure idempotency (running the same transaction twice should yield the same result).

## Features

### Real-time (`watch`)

Observes keys or prefixes. The callback receives an array of `KvEntry` when something changes; `value: null` indicates deletion.

```typescript
const handle = kv.watch(["users", userId], (entries) => { /* ... */ });
// Default: prefix (key + children). { exact: true } = only the key.
handle.stop();
```

Modes: SSE (default, low latency) and polling (proxy compatibility). REST endpoint and operational details in [`./plugin-keyval.md`](./plugin-keyval.md#watch-sse).

> Each watcher polls ~100 ms per key. Keep to < 100 simultaneous watchers; for many keys, consolidate into a periodic `list`.

### FTS (Full-Text Search)

The only **automatic** index in KeyVal — maintained by the server in sync with `set`/`delete`/atomic. Each prefix supports at most one index; recreating replaces the previous one.

```typescript
await kv.createIndex(["articles"], { fields: ["title", "content"], tokenize: "porter" });
for await (const e of kv.search<Article>(["articles"], "typescript", {
  where: { status: "published" },
  limit: 20,
})) { /* ... */ }
```

| Tokenizer | When |
|-----------|------|
| `unicode61` (default) | Multilingual, accented content |
| `porter` | English with stemming (run/running/runs → run) |
| `ascii` | Identifiers, pure ASCII logs, performance |

Limitations: only strings are indexed; the index is **not** retroactive (existing data must be reindexed); advanced FTS5 operators (`OR`, `NOT`, `NEAR`, exact phrases) are **not** supported — only word-based search with ranking. For full syntax and REST endpoints, see [`./plugin-keyval.md`](./plugin-keyval.md#full-text-search).

### Queues

FIFO with at-least-once delivery, delay, configurable backoff, and DLQ.

```typescript
await kv.enqueue(
  { type: "send_email", to: "user@example.com" },
  {
    delay: 0,
    backoffSchedule: [1000, 5000, 30000],          // 3 retries
    keysIfUndelivered: [["failed", "email-123"]],  // fallback after retries exhausted
  },
);

kv.listenQueue(async (msg) => {
  // msg: { id, value, attempts }
  await process(msg.value);
});
```

Mechanics: `enqueue` → `pending` → `dequeue` lock → `ack` (removes) or `nack` (retry with backoff up to DLQ). An expired lock returns the message to `pending`. Operational details (DLQ, lock duration, cleanup) in [`./plugin-keyval.md`](./plugin-keyval.md#queues).

> Handler idempotency is required — at-least-once delivery allows redelivery on a crash between dequeue and ack.

### Expiration (TTL)

```typescript
await kv.set(["session", id], data, { expiresIn: "7d" });
await kv.set(["cache", key], data, { expiresIn: 300_000 }); // ms also accepted
```

String formats: `ms`, `s`, `m`, `h`, `d`, `w`, `y`. After expiration, `get()` returns `null` and background cleanup physically removes the entry.

| Pattern | Behavior | Use case |
|---------|----------|----------|
| **Sliding** | Re-`set` on each access renews TTL | Session (stays logged in while active) |
| **Absolute** | Fixed TTL, does not renew | Verification token, reset code |

**There is no native `extend()`** — use `get()` + `set()` with a new TTL.

> Maximum TTL in the current plugin: ~24.8 days (`2_147_483_647 ms`). Larger values require periodic renewal via a scheduled `enqueue`.

## Modeling patterns

The highest-value section: how to map real-world domains to keys.

### 1:1 relationships

| Strategy | When | Trade-off |
|----------|------|-----------|
| **Embedded** in the main document | Data always accessed together | Larger document; naturally atomic updates |
| **Separate key** (`["users", id, "profile"]`) | Independent access | Multiple calls if both are needed; manual consistency |

### 1:N relationships

Two strategies with different semantics:

| Strategy | Structure | When |
|----------|-----------|------|
| **Hierarchical** | `["users", uid, "posts", pid]` | Child belongs to parent; **automatic cascading delete** |
| **Reference + index** | `["posts", pid] → { authorId }` + `["posts_by_author", uid, pid] → pid` | Independent child; global queries; co-authorship |

### N:N relationships

Bidirectional join table:

```typescript
["posts", pid] → { title, tags }
["tags", tag] → { description, count }
["post_tags", pid, tag] → kv.now()
["tag_posts", tag, pid] → kv.now()
```

Create/update/remove must maintain **both sides** in a single `atomic` (including the counter `["tags", tag, "count"]`).

### Secondary indexes (manual)

| Type | Structure | Use case |
|------|-----------|----------|
| **Unique** | `["users_by_email", email] → id` | Email, SSN, username — `check({ versionstamp: null })` on creation |
| **Non-unique** | `["users_by_city", city, id] → id` | City, status, category — ID in the key to avoid collision |
| **Composite** | `["products_by_cat_price", cat, price, id] → id` | "Category X ordered by price" query |
| **Temporal** | `["events_by_time", ts, id] → id` (or UUIDv7) | "Recent events", logs |
| **Inverted** | `["tags", tag, postId] → postId` | N:N (tags) |
| **Prefix** | `["users_by_name", "ali"] → ["usr_001", ...]` | Autocomplete |

**Maintenance** is the application's responsibility. Always inside `atomic()`:

```typescript
// Email update — updates user + removes old index + creates new index
await kv.atomic()
  .check(userEntry)
  .check({ key: ["users_by_email", newEmail], versionstamp: null })
  .set(["users", id], { ...user, email: newEmail })
  .delete(["users_by_email", oldEmail])
  .set(["users_by_email", newEmail], id)
  .commit();
```

**Cost.** Each index = +1 mutation per write and +1x storage; reads become O(1) instead of O(n). Rebuilding is possible via `list` + `set` in batches when an index becomes inconsistent.

**Denormalization in the index** (`["users_by_city", city, id] → { id, name, email }` instead of just `id`) eliminates the extra lookup when listing — only for data that changes rarely.

### Domain patterns

| Pattern | Typical structure | When |
|---------|-------------------|------|
| Simple entity + audit | `["users", id] → { id, ..., createdAt, updatedAt }` | Basic CRUD |
| Embedded document | `["orders", id] → { items, shipping, totals }` | Data always accessed together |
| Aggregated hierarchy | `["orgs", oid, "projects", pid, "tasks", tid]` | Multi-tenant; cascading delete |
| Atomic counters | `["stats", "posts", pid, "views"] → bigint` | High-frequency metrics |
| Pre-computed aggregation | `["stats", "sales", year, month, "count/total"]` | Dashboards; no runtime `GROUP BY` |
| TTL | `["session", sid] → data` (with `expiresIn`) | Sessions, cache, tokens, distributed locks |
| Rate limiting | `["rate_limit", id, window] → count` (TTL = window) | API protection |
| Feature flags | `["features", name] → { enabled, percentage, enabledFor }` | Gradual rollout, A/B |
| Audit log (3-way index) | `["audit", "by_time", ts, id]` + `["audit", "by_actor", uid, ts, id]` + `["audit", "by_target", type, tid, ts, id]` | GDPR, debugging, compliance |
| Workflow / state machine | `["orders", id] → { status, statusHistory }` + `["orders_by_status", st, id]` | Orders, processes with transitions |
| Soft delete | `deletedAt` in the value + parallel `["deleted_users", id]` | Recovery, compliance |

#### Multi-tenancy

For tenant isolation, **prefix all keys**:

```typescript
["t", tenantId, "users", userId]
["t", tenantId, "users_by_email", email]
["t", tenantId, "stats", "users", "total"]
```

`delete(["t", tenantId])` removes everything for the tenant. Watchers and indexes are naturally isolated.

### When to denormalize

| Factor | Denormalize | Do not denormalize |
|--------|-------------|-------------------|
| Read vs write ratio | Many reads, few writes | Frequent writes |
| Change frequency | Rarely changing data (author name) | Hot data (balance, follower count) |
| Consistency | Eventual is acceptable | Strong consistency required |
| Update strategy | Async job via `enqueue` to propagate | — |

> **Anti-pattern.** Denormalizing `authorFollowers` into each post: changes constantly, costs N updates per change.

## Known limitations

Conceptual limitations of the KV approach (not exclusive to the Buntime plugin). For server operational limits (Watch polling, SQLite single writer, missing automatic retry in transactions, BigInt precision), see the **Limitations** section of [`./plugin-keyval.md`](./plugin-keyval.md#limitations).

| Area | Limitation | Mitigation |
|------|------------|------------|
| Ad-hoc queries | No arbitrary `WHERE x AND y AND z ORDER BY w` | Pre-defined indexes for known queries; server-side `where` for non-hot fields; PostgreSQL for reports |
| JOINs | No native JOIN | Multiple batch `get` calls or controlled denormalization |
| Aggregations | No `GROUP BY`/`AVG`/percentiles | `sum`/`max`/`min` counters maintained in `atomic`; analytics database for the rest |
| Long transactions | Higher conflict probability; prolonged lock in SQLite | Keep short; process iteration outside; ensure idempotency |
| Key part size | 1 KB (string/Uint8Array); depth 20 parts | Validate in the application; short, focused keys |
| Operations per atomic | ~1,000 (recommended < 100) | Partition into batches |
| Value size | No hard limit (libSQL/SQLite up to 1 GB) | For > 1 MB, **external storage (S3/R2)** with a reference in KeyVal; chunking only if unavoidable |
| Numeric keys | Lexicographic, not numeric | Zero-padding, ULID, UUIDv7, inverted timestamp |

### Migration tips

| From | To |
|------|----|
| **Redis** strings | `set(["key"], value)` |
| **Redis** hashes | `set(["hash", field], value)` or JSON object |
| **Redis** sorted sets | `["zset", score, member]` (composite index) |
| **Redis** TTL | `expiresIn` |
| **Redis** Pub/Sub | `watch()` + event pattern |
| **MongoDB** collections | Prefix: `["users", id]` |
| **MongoDB** documents | JSON values |
| **MongoDB** indexes | Manual indexes |
| **DynamoDB** PK | Key |
| **DynamoDB** SK | Key part: `["table", pk, sk]` |
| **DynamoDB** GSI | Manual secondary indexes |
| **DynamoDB** Streams | `watch()` |

### Combining with other databases

KeyVal does not replace RDBMS for everything. Recommended pattern in real-world apps:

```typescript
// PostgreSQL: relational data and reports
const orders = await db.query(`SELECT * FROM orders WHERE user_id = $1`, [uid]);

// KeyVal: session, cache, queues, real-time
const session = await kv.get(["session", sid]);
await kv.set(["cache", "user", uid], data, { expiresIn: "5m" });
await kv.enqueue({ type: "send_email", uid });
kv.watch(["orders", uid], notifyClient);
```

For the server side (REST + SSE), endpoints, plugin configuration, troubleshooting, and operational limitations — see [`./plugin-keyval.md`](./plugin-keyval.md). For the canonical exports table (`Kv`, `KvAtomicOperation`, types) — see [`./packages.md`](./packages.md#buntimekeyval).
