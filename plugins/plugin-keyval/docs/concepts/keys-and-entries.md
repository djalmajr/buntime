# Keys and Entries

How keys, entries, TTL, and versionstamps work in plugin-keyval.

## Keys

Keys are **arrays of parts**. Each part can be one of the following types:

| Type | Example | Description |
|------|---------|-------------|
| `string` | `"users"` | Most common type |
| `number` | `42` | Numeric keys |
| `bigint` | `9007199254740992n` | Large integers |
| `boolean` | `true` | Boolean flags |
| `Uint8Array` | `new Uint8Array([1, 2])` | Binary data |

### Key Examples

```typescript
["users", "123"]                    // Simple two-part key
["users", 42, "profile"]           // Mixed types
["metrics", "2024-01-01", "cpu"]   // Date-based hierarchical key
["config"]                         // Single-part key
["flags", true]                    // Boolean part
```

### Key Ordering

Keys are encoded in binary format with type-prefixed ordering. The lexicographic sort order is:

1. `Uint8Array` (lowest)
2. `string`
3. `number`
4. `bigint`
5. `boolean` (highest)

Within the same type, values are sorted naturally (alphabetical for strings, numeric for numbers).

### Key Constraints

| Constraint | Limit |
|-----------|-------|
| Maximum parts | 20 |
| Part types | `string`, `number`, `bigint`, `boolean`, `Uint8Array` |
| Key must be non-empty | At least 1 part required |

### REST API Key Paths

In the REST API, keys are represented as URL paths. Parts are separated by `/`:

```
/keyval/api/keys/users/123           → ["users", "123"]
/keyval/api/keys/config/theme        → ["config", "theme"]
/keyval/api/keys/metrics/2024/cpu    → ["metrics", "2024", "cpu"]
```

For `POST` endpoints (like `/keys/list`, `/atomic`), keys are sent as JSON arrays in the request body.

### Composite Key Design

Composite keys enable hierarchical data organization and efficient prefix-based queries:

```typescript
// User data organized hierarchically
["users", "123"]                  // User record
["users", "123", "profile"]      // User profile
["users", "123", "settings"]     // User settings
["users", "123", "posts", "p1"]  // User's post

// List all data for user 123
for await (const entry of kv.list(["users", "123"])) {
  console.log(entry.key, entry.value);
}

// List only user profiles
for await (const entry of kv.list(["users", "123", "profile"])) {
  console.log(entry.value);
}
```

### Secondary Indexes via Keys

Use composite keys to create secondary indexes:

```typescript
// Primary: store user by ID
await kv.set(["users", userId], user);

// Secondary: index by email
await kv.set(["users_by_email", user.email], userId);

// Secondary: index by status for efficient listing
await kv.set(["users_by_status", "active", userId], userId);

// Query by status without where filters
for await (const entry of kv.list(["users_by_status", "active"])) {
  const userId = entry.value;
  const user = await kv.get(["users", userId]);
}
```

## Entries

Each entry stored in KeyVal has three fields:

```typescript
interface KvEntry<T = unknown> {
  key: KvKey;            // Array of key parts
  value: T | null;       // JSON-serializable value
  versionstamp: string | null;  // Version for concurrency control
}
```

### Value Types

Values can be any JSON-serializable data:

```typescript
// Object
await kv.set(["users", "123"], { name: "Alice", age: 30, active: true });

// String
await kv.set(["config", "theme"], "dark");

// Number
await kv.set(["counters", "visits"], 42);

// Array
await kv.set(["tags", "post-1"], ["javascript", "tutorial"]);

// Boolean
await kv.set(["flags", "maintenance"], false);

// Null
await kv.set(["temp", "placeholder"], null);

// Nested objects
await kv.set(["products", "p1"], {
  name: "Laptop",
  details: {
    price: 999.99,
    manufacturer: { country: "Japan" }
  }
});
```

### Non-Existent Entries

When a key does not exist, `get()` returns an entry with `value: null` and `versionstamp: null`:

```typescript
const entry = await kv.get(["nonexistent"]);
// { key: ["nonexistent"], value: null, versionstamp: null }

if (entry.value === null) {
  console.log("Key does not exist");
}
```

## TTL (Time To Live)

Set automatic expiration on entries using `expiresIn` (in milliseconds):

```typescript
// Expire in 1 hour (3,600,000 ms)
await kv.set(["sessions", "abc"], sessionData, { expiresIn: 3600000 });

// Expire in 24 hours
await kv.set(["cache", "api-response"], data, { expiresIn: 86400000 });
```

### REST API TTL

```bash
# Set with 1 hour TTL
curl -X PUT "http://localhost:8000/keyval/api/keys/sessions/abc?expiresIn=3600000" \
  -H "Content-Type: application/json" \
  -d '{"userId": "123"}'
```

### TTL in Atomic Operations

```json
{
  "mutations": [
    {
      "type": "set",
      "key": ["sessions", "abc"],
      "value": { "userId": "123" },
      "expiresIn": 3600000
    }
  ]
}
```

### TTL Constraints

| Constraint | Value |
|-----------|-------|
| Maximum `expiresIn` | 2,147,483,647 ms (~24.8 days) |
| Minimum `expiresIn` | 1 ms |
| Type | Positive integer |

### Expiration Behavior

- Expired entries are automatically excluded from `get()`, `list()`, and `count()` operations
- Expired entries are cleaned up in the background
- TTL is stored as an absolute timestamp (`expires_at`) in the database
- Setting a new value on an existing key with a different TTL updates the expiration
- Setting a value without `expiresIn` on a key that previously had TTL removes the expiration

## Versionstamps

Every write operation generates a unique **versionstamp** - a string that represents the version of an entry at a specific point in time.

### How Versionstamps Work

```typescript
// First write
const result1 = await kv.set(["users", "123"], { name: "Alice" });
// result1.versionstamp: "00000000000000010000"

// Second write
const result2 = await kv.set(["users", "123"], { name: "Alice Updated" });
// result2.versionstamp: "00000000000000020000"

// Reading always returns the latest versionstamp
const entry = await kv.get(["users", "123"]);
// entry.versionstamp: "00000000000000020000"
```

### Versionstamp States

| State | Meaning |
|-------|---------|
| Non-null string (e.g., `"00000001"`) | Entry exists with this version |
| `null` | Entry does not exist |

### Using Versionstamps for Concurrency Control

Versionstamps enable **optimistic concurrency control** in atomic operations. You read an entry, capture its versionstamp, then use it as a check condition when writing:

```typescript
// 1. Read the current value
const entry = await kv.get(["users", "123"]);
// entry.versionstamp: "00000000000000010000"

// 2. Modify the value
const updated = { ...entry.value, name: "Alice Updated" };

// 3. Write atomically, checking the versionstamp hasn't changed
const result = await kv.atomic()
  .check({ key: ["users", "123"], versionstamp: entry.versionstamp })
  .set(["users", "123"], updated)
  .commit();

if (result.ok) {
  console.log("Updated successfully");
} else {
  console.log("Conflict! Another write happened between read and write");
}
```

### Checking for Non-Existence

Use `versionstamp: null` to ensure a key does NOT exist:

```typescript
// Only create if key doesn't already exist
const result = await kv.atomic()
  .check({ key: ["users", "new-id"], versionstamp: null })
  .set(["users", "new-id"], { name: "New User" })
  .commit();

if (!result.ok) {
  console.log("Key already exists!");
}
```

## Batch Operations

### Batch Get

Retrieve multiple keys in a single request:

```typescript
// SDK
const entries = await kv.get([
  ["users", "123"],
  ["users", "456"],
  ["config", "theme"]
]);
// Returns array of entries in same order as keys
```

```bash
# REST API
curl -X POST http://localhost:8000/keyval/api/keys/batch \
  -H "Content-Type: application/json" \
  -d '{"keys": [["users", "123"], ["users", "456"], ["config", "theme"]]}'
```

### Batch Delete

Delete multiple keys in a single request:

```bash
curl -X POST http://localhost:8000/keyval/api/keys/delete-batch \
  -H "Content-Type: application/json" \
  -d '{"keys": [["users", "123"], ["cache", "old"]], "exact": true}'
```

## Delete Behavior

The `delete` operation has three modes:

### 1. Prefix Delete (Default)

Deletes the key AND all children:

```typescript
// Given keys: ["users", "123"], ["users", "123", "profile"], ["users", "123", "settings"]
await kv.delete(["users", "123"]);
// All three keys are deleted
```

### 2. Exact Delete

Deletes only the exact key, preserving children:

```typescript
await kv.delete(["users", "123"], { exact: true });
// Only ["users", "123"] is deleted
// ["users", "123", "profile"] and ["users", "123", "settings"] remain
```

### 3. Filtered Delete

Uses the key as a prefix and applies a where filter:

```typescript
const result = await kv.delete(["tasks"], {
  where: { status: { $eq: "completed" } }
});
console.log(`Deleted ${result.deletedCount} completed tasks`);
```

## Next Steps

- [Atomic Operations](atomic-operations.md) - Transactions and concurrency
- [Queues](queues.md) - Message queue system
- [Where Filters](../guides/where-filters.md) - Filter operators
- [API Reference](../api-reference.md) - Complete endpoint reference
