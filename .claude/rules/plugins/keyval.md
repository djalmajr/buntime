# KeyVal Plugin

Deno KV-like key-value store for Buntime. Client: `@buntime/keyval`, Server: `@buntime/plugin-keyval`.

## Client Setup

```typescript
import { Kv } from "@buntime/keyval";
const kv = new Kv("http://localhost:8000/keyval/api");
```

## Keys

Composite arrays of primitives:

```typescript
type KvKey = (string | number | bigint | boolean | Uint8Array)[];

["users", 123]
["posts", 456, "comments", 0]
```

## CRUD

```typescript
// Get (single or batch)
const entry = await kv.get(["users", 123]);
const entries = await kv.get([["users", 1], ["users", 2]]);

// Set (with optional TTL)
await kv.set(["users", 123], { name: "Alice" });
await kv.set(["cache", "data"], data, { expiresIn: "1h" });

// Delete (prefix or exact)
await kv.delete(["users", 123]);                    // prefix (includes children)
await kv.delete(["users", 123], { exact: true });   // exact key only
await kv.delete(["sessions"], { where: { expiresAt: { $lt: kv.now() } } });

// Count
const count = await kv.count(["users"]);
```

## List & Pagination

```typescript
// Async iterator
for await (const entry of kv.list(["users"])) {
  console.log(entry.key, entry.value);
}

// With options
for await (const entry of kv.list(["users"], {
  limit: 10,
  reverse: true,
  where: { status: { $eq: "active" } }
})) { ... }

// Cursor-based pagination
const page = await kv.paginate(["users"], { limit: 10 });
const next = await kv.paginate(["users"], { limit: 10, cursor: page.cursor });
```

## Where Filters

```typescript
// Comparison
{ age: { $eq: 18 } }
{ age: { $ne: 0 } }
{ age: { $gt: 18 } }
{ age: { $gte: 18 } }
{ age: { $lt: 100 } }
{ age: { $lte: 100 } }
{ price: { $between: [100, 500] } }

// Array
{ status: { $in: ["active", "pending"] } }
{ status: { $nin: ["deleted"] } }

// String (case-sensitive)
{ name: { $contains: "Silva" } }
{ name: { $startsWith: "Dr." } }
{ email: { $endsWith: "@company.com" } }

// String (case-insensitive) - add 'i' suffix
{ name: { $containsi: "silva" } }
{ code: { $startsWithi: "br_" } }

// Existence
{ deletedAt: { $null: true } }
{ tags: { $empty: false } }

// Logical
{ $and: [{ status: "active" }, { age: { $gt: 18 } }] }
{ $or: [{ status: "expired" }, { expiresAt: { $lt: kv.now() } }] }
{ $not: { status: "inactive" } }

// Nested fields
{ "profile.verified": { $eq: true } }
{ "items[0].price": { $gt: 100 } }

// Shorthand (equals)
{ status: "active" }  // same as { status: { $eq: "active" } }
```

## Server Timestamp

Avoid client/server time skew:

```typescript
kv.now()              // current server time
kv.now().add("1h")    // +1 hour
kv.now().sub("24h")   // -24 hours

// Use in filters
{ expiresAt: { $lt: kv.now() } }
{ publishedAt: { $lte: kv.now().sub("7d") } }
```

## Atomic Operations

```typescript
await kv.atomic()
  .set(["posts", id], post)
  .set(["cache", "key"], data, { expiresIn: "1h" })
  .delete(["temp", id])
  .sum(["views", id], 1n)      // increment
  .max(["highscore", id], 100n)
  .min(["lowscore", id], 50n)
  .append(["tags", id], ["new"])
  .prepend(["history", id], [event])
  .commit();
```

## Transactions

Snapshot isolation with optimistic concurrency:

```typescript
const result = await kv.transaction(async (tx) => {
  const from = await tx.get(["accounts", fromId]);
  const to = await tx.get(["accounts", toId]);

  tx.set(["accounts", fromId], { balance: from.value.balance - amount });
  tx.set(["accounts", toId], { balance: to.value.balance + amount });

  return { transferred: amount };
}, { maxRetries: 3, retryDelay: 100 });
```

## Full-Text Search

```typescript
// Create index
await kv.createIndex(["posts"], {
  fields: ["title", "content"],
  tokenize: "unicode61"  // or "porter", "ascii"
});

// Search
for await (const entry of kv.search(["posts"], "typescript")) {
  console.log(entry.value.title);
}

// Search with filter
for await (const entry of kv.search(["posts"], "react", {
  limit: 10,
  where: { status: "published" }
})) { ... }

// Manage indexes
const indexes = await kv.listIndexes();
await kv.removeIndex(["posts"]);
```

## Queue

```typescript
// Enqueue
await kv.enqueue({ type: "email", to: "user@example.com" });
await kv.enqueue(data, { delay: "5s" });
await kv.enqueue(data, { backoffSchedule: ["1s", "5s", "30s"] });

// Listen (SSE by default)
const handle = kv.listenQueue(async (msg) => {
  console.log("Processing:", msg.value, "Attempt:", msg.attempts);
  // throw to retry, return to ack
});

// Polling mode
const handle = kv.listenQueue(handler, { mode: "polling", pollInterval: 2000 });

// Stop
handle.stop();

// Stats
const stats = await kv.queueStats();
// { pending: 5, processing: 2, dlq: 1, total: 8 }
```

## Dead Letter Queue

```typescript
const messages = await kv.dlq.list({ limit: 10 });
const msg = await kv.dlq.get("id");
await kv.dlq.requeue("id");
await kv.dlq.delete("id");
await kv.dlq.purge();
```

## Watch (Real-time)

```typescript
// Watch prefix (includes children)
const handle = kv.watch(["users", 123], (entries) => {
  console.log("Changed:", entries);
});

// Watch multiple
kv.watch([["users", 123], ["orders", 456]], callback);

// Watch exact key only
kv.watch(["users", 123], callback, { exact: true });

// Polling mode
kv.watch(["users"], callback, { mode: "polling", pollInterval: 2000 });

// Backpressure
kv.watch(["users"], callback, {
  bufferSize: 100,
  overflowStrategy: "drop-oldest"  // or "drop-newest"
});

// Stop
handle.stop();

// Auto cleanup
{
  using watcher = kv.watch(keys, callback);
  await process();
} // auto stop
```

## Metrics

```typescript
const metrics = await kv.metrics();        // JSON
const prom = await kv.metrics("prometheus"); // Prometheus format
```

## Duration Format

Wherever duration is accepted:

```typescript
1000         // milliseconds
"500ms"      // milliseconds
"30s"        // seconds
"5m"         // minutes
"1h"         // hours
"7d"         // days
```

## Plugin Config

```jsonc
// buntime.jsonc
{
  "plugins": [
    ["@buntime/plugin-database", {
      "adapters": [{ "type": "libsql", "default": true }]
    }],
    ["@buntime/plugin-keyval", {
      "database": "libsql",
      "metrics": { "persistent": true, "flushInterval": 30000 },
      "queue": { "cleanupInterval": 60000, "lockDuration": 30000 }
    }]
  ]
}
```

## SSE Pattern (Main Thread)

Para SSE no cliente via watch:

```typescript
// Cliente conecta diretamente ao KeyVal watch
const kv = new Kv("/keyval/api");
kv.watch(["events"], (entries) => {
  for (const entry of entries) {
    updateUI(entry.value);
  }
});

// Worker escreve eventos
await kv.set(["events", Date.now()], { type: "update", data: ... });
// Watch no cliente recebe automaticamente
```
