# API Reference

Complete reference for the plugin-keyval REST API.

## Base URL

All routes are served under the plugin base path:

```
/keyval/api/*
```

## Content Type

All request and response bodies use `application/json` unless otherwise noted.

## Error Format

```json
{
  "error": "Error message"
}
```

## HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `400` | Validation error |
| `404` | Resource not found |
| `500` | Internal server error |

---

## Key-Value Operations

### GET /api/keys/*

Get a single entry by key path.

#### Request

```http
GET /keyval/api/keys/users/123
```

#### Response

```json
{
  "key": ["users", "123"],
  "value": { "name": "Alice", "email": "alice@example.com" },
  "versionstamp": "00000000000000010000"
}
```

**Status:** `200 OK`

**Error Response (Key Not Found):**

```json
{
  "error": "Key not found"
}
```

**Status:** `404 Not Found`

#### Example

```bash
curl http://localhost:8000/keyval/api/keys/users/123
```

---

### PUT /api/keys/*

Set or update an entry value.

#### Request

```http
PUT /keyval/api/keys/users/123?expiresIn=3600000
Content-Type: application/json

{
  "name": "Alice",
  "email": "alice@example.com",
  "active": true
}
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | `number` | - | TTL in milliseconds (max: 2147483647) |

#### Response

```json
{
  "ok": true,
  "versionstamp": "00000000000000030000"
}
```

**Status:** `200 OK`

#### Examples

```bash
# Set without TTL
curl -X PUT http://localhost:8000/keyval/api/keys/users/123 \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Set with 1 hour TTL
curl -X PUT "http://localhost:8000/keyval/api/keys/sessions/abc?expiresIn=3600000" \
  -H "Content-Type: application/json" \
  -d '{"userId": "123", "createdAt": 1234567890}'
```

---

### DELETE /api/keys/*

Delete an entry by key path. Supports three modes:

1. **Simple delete** (no body) - deletes the key AND all sub-keys (children)
2. **Exact delete** (`exact: true`) - deletes ONLY the exact key, not children
3. **Filtered delete** (`where` in body) - key becomes a prefix, deletes matching entries

#### Request

```http
DELETE /keyval/api/keys/users/123
```

**Optional Body:**

```json
{
  "exact": true,
  "where": {
    "status": "completed"
  }
}
```

#### Response

```json
{
  "deletedCount": 3
}
```

**Status:** `200 OK`

#### Examples

```bash
# Simple delete (key + all children)
curl -X DELETE http://localhost:8000/keyval/api/keys/users/123

# Exact delete (only this key, not children)
curl -X DELETE http://localhost:8000/keyval/api/keys/users/123 \
  -H "Content-Type: application/json" \
  -d '{"exact": true}'

# Delete with where filter (prefix-based)
curl -X DELETE http://localhost:8000/keyval/api/keys/tasks \
  -H "Content-Type: application/json" \
  -d '{"where": {"status": "completed"}}'
```

---

### GET /api/keys

List entries by prefix with simple pagination.

#### Request

```http
GET /keyval/api/keys?prefix=users&limit=50&reverse=true
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | `""` | Key prefix (e.g., `users` for `["users", ...]`) |
| `start` | `string` | - | Start key (inclusive, format: `part1/part2`) |
| `end` | `string` | - | End key (exclusive, format: `part1/part2`) |
| `limit` | `number` | `100` | Max entries to return (max: 1000) |
| `reverse` | `boolean` | `false` | Return in reverse order |

#### Response

```json
[
  {
    "key": ["users", "001"],
    "value": { "name": "Alice" },
    "versionstamp": "00000000000000010000"
  },
  {
    "key": ["users", "002"],
    "value": { "name": "Bob" },
    "versionstamp": "00000000000000020000"
  }
]
```

**Status:** `200 OK`

#### Examples

```bash
# List all entries with prefix "users"
curl "http://localhost:8000/keyval/api/keys?prefix=users&limit=50"

# List in reverse order
curl "http://localhost:8000/keyval/api/keys?prefix=users&reverse=true"

# List with range
curl "http://localhost:8000/keyval/api/keys?prefix=users&start=users/100&end=users/200"
```

---

### POST /api/keys/list

List entries with complex where filters. Use this endpoint when filtering is needed.

#### Request

```http
POST /keyval/api/keys/list
Content-Type: application/json

{
  "prefix": ["users"],
  "start": ["users", "100"],
  "end": ["users", "200"],
  "limit": 100,
  "reverse": false,
  "where": {
    "status": { "$eq": "active" },
    "age": { "$gt": 18 }
  }
}
```

**Body Parameters:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prefix` | `KvKey` | `[]` | Key prefix as array |
| `start` | `KvKey` | - | Start key (inclusive) |
| `end` | `KvKey` | - | End key (exclusive) |
| `limit` | `number` | `100` | Max entries (max: 1000) |
| `reverse` | `boolean` | `false` | Reverse order |
| `where` | `KvWhereFilter` | - | Where filter object |

#### Response

```json
[
  {
    "key": ["users", "001"],
    "value": { "name": "Alice", "status": "active", "age": 25 },
    "versionstamp": "00000000000000010000"
  }
]
```

**Status:** `200 OK`

#### Examples

```bash
# List active users
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{"prefix": ["users"], "where": {"status": {"$eq": "active"}}}'

# List with multiple filters and $or
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["users"],
    "where": {
      "$or": [
        {"role": {"$eq": "admin"}},
        {"role": {"$eq": "moderator"}}
      ]
    }
  }'

# Non-expired sessions using server timestamp
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["sessions"],
    "where": {"expiresAt": {"$gt": {"$now": true}}}
  }'
```

---

### GET /api/keys/count

Count entries by prefix.

#### Request

```http
GET /keyval/api/keys/count?prefix=users
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | `""` | Key prefix (empty = all keys) |

#### Response

```json
{
  "count": 42
}
```

**Status:** `200 OK`

#### Examples

```bash
# Count all entries
curl http://localhost:8000/keyval/api/keys/count

# Count entries with prefix "users"
curl "http://localhost:8000/keyval/api/keys/count?prefix=users"
```

---

### GET /api/keys/paginate

Cursor-based pagination for efficient navigation through large datasets.

#### Request

```http
GET /keyval/api/keys/paginate?prefix=users&limit=10&cursor=dXNlcnMvMDAy
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | `""` | Key prefix |
| `cursor` | `string` | - | Cursor from previous page (base64) |
| `limit` | `number` | `100` | Max entries (max: 1000) |
| `reverse` | `boolean` | `false` | Reverse order |

#### Response

```json
{
  "entries": [
    {
      "key": ["users", "001"],
      "value": { "name": "Alice" },
      "versionstamp": "00000000000000010000"
    }
  ],
  "cursor": "dXNlcnMvMDAy",
  "hasMore": true
}
```

**Status:** `200 OK`

**Fields:**
- `entries`: Array of KvEntry objects for this page
- `cursor`: Cursor for the next page (`null` if no more pages)
- `hasMore`: Whether more entries exist beyond this page

#### Examples

```bash
# First page
curl "http://localhost:8000/keyval/api/keys/paginate?prefix=users&limit=10"

# Next page (using returned cursor)
curl "http://localhost:8000/keyval/api/keys/paginate?prefix=users&limit=10&cursor=dXNlcnMvMDAy"
```

---

### POST /api/keys/batch

Batch get multiple keys in a single request.

#### Request

```http
POST /keyval/api/keys/batch
Content-Type: application/json

{
  "keys": [
    ["users", "123"],
    ["posts", "456"]
  ]
}
```

**Validation:**
- Maximum 1000 keys per request
- Each key may have at most 20 parts

#### Response

```json
[
  {
    "key": ["users", "123"],
    "value": { "name": "Alice" },
    "versionstamp": "00000000000000010000"
  },
  {
    "key": ["posts", "456"],
    "value": null,
    "versionstamp": null
  }
]
```

**Status:** `200 OK`

> **Note:** Non-existent keys return `value: null` and `versionstamp: null`. Response order matches the request key order.

#### Example

```bash
curl -X POST http://localhost:8000/keyval/api/keys/batch \
  -H "Content-Type: application/json" \
  -d '{"keys": [["users", "123"], ["posts", "456"]]}'
```

---

### POST /api/keys/delete-batch

Batch delete multiple keys in a single request.

#### Request

```http
POST /keyval/api/keys/delete-batch
Content-Type: application/json

{
  "keys": [
    ["users", "123"],
    ["posts", "456"]
  ],
  "exact": true,
  "where": {
    "status": "completed"
  }
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keys` | `KvKey[]` | Yes | Array of keys to delete (max: 1000) |
| `exact` | `boolean` | No | If `true`, delete only exact keys (no children) |
| `where` | `KvWhereFilter` | No | Filter applied to each key |

#### Response

```json
{
  "deletedCount": 7
}
```

**Status:** `200 OK`

> **Note:** When `exact` is `false` or omitted, each key is treated as a prefix and all children are also deleted. `deletedCount` returns the total sum of all entries removed.

#### Examples

```bash
# Delete batch (keys + children)
curl -X POST http://localhost:8000/keyval/api/keys/delete-batch \
  -H "Content-Type: application/json" \
  -d '{"keys": [["users", "123"], ["posts", "456"]]}'

# Delete batch exact (no children)
curl -X POST http://localhost:8000/keyval/api/keys/delete-batch \
  -H "Content-Type: application/json" \
  -d '{"keys": [["users", "123"]], "exact": true}'

# Delete batch with where filter
curl -X POST http://localhost:8000/keyval/api/keys/delete-batch \
  -H "Content-Type: application/json" \
  -d '{"keys": [["tasks"]], "where": {"status": "completed"}}'
```

---

## Atomic Operations

### POST /api/atomic

Execute atomic operations with optimistic concurrency control.

#### Request

```http
POST /keyval/api/atomic
Content-Type: application/json

{
  "checks": [
    { "key": ["users", "123"], "versionstamp": "00000000000000010000" }
  ],
  "mutations": [
    { "type": "set", "key": ["users", "123"], "value": { "name": "Alice" }, "expiresIn": 3600000 },
    { "type": "delete", "key": ["temp", "data"] },
    { "type": "sum", "key": ["counters", "visits"], "value": 1 },
    { "type": "max", "key": ["stats", "peak"], "value": 100 },
    { "type": "min", "key": ["stats", "low"], "value": 5 },
    { "type": "append", "key": ["lists", "tags"], "value": ["new-tag"] },
    { "type": "prepend", "key": ["lists", "recent"], "value": ["latest"] }
  ]
}
```

**Mutation Types:**

| Type | Parameters | Description |
|------|------------|-------------|
| `set` | `key`, `value`, `expiresIn?` | Set key to value |
| `delete` | `key` | Delete key |
| `sum` | `key`, `value` (number/bigint) | Add to current value |
| `max` | `key`, `value` (number/bigint) | Set to max of current and new |
| `min` | `key`, `value` (number/bigint) | Set to min of current and new |
| `append` | `key`, `value` (array) | Append items to array value |
| `prepend` | `key`, `value` (array) | Prepend items to array value |

#### Response (Success)

```json
{
  "ok": true,
  "versionstamp": "00000000000000050000"
}
```

**Status:** `200 OK`

#### Response (Check Failed)

```json
{
  "ok": false
}
```

**Status:** `200 OK`

> **Note:** A check failure is not an HTTP error. The response body indicates success or failure via the `ok` field.

#### Response (Validation Error)

```json
{
  "error": "append value must be an array"
}
```

**Status:** `400 Bad Request`

#### Examples

```bash
# Increment counter atomically
curl -X POST http://localhost:8000/keyval/api/atomic \
  -H "Content-Type: application/json" \
  -d '{
    "mutations": [
      {"type": "sum", "key": ["counters", "visits"], "value": 1}
    ]
  }'

# Conditional update (only if versionstamp matches)
curl -X POST http://localhost:8000/keyval/api/atomic \
  -H "Content-Type: application/json" \
  -d '{
    "checks": [
      {"key": ["users", "123"], "versionstamp": "00000000000000010000"}
    ],
    "mutations": [
      {"type": "set", "key": ["users", "123"], "value": {"name": "Alice Updated"}}
    ]
  }'

# Multiple atomic operations
curl -X POST http://localhost:8000/keyval/api/atomic \
  -H "Content-Type: application/json" \
  -d '{
    "mutations": [
      {"type": "set", "key": ["posts", "123"], "value": {"title": "Hello"}},
      {"type": "append", "key": ["posts", "all"], "value": ["123"]},
      {"type": "sum", "key": ["stats", "total_posts"], "value": 1}
    ]
  }'

# Check for non-existence (versionstamp: null)
curl -X POST http://localhost:8000/keyval/api/atomic \
  -H "Content-Type: application/json" \
  -d '{
    "checks": [
      {"key": ["users", "new-id"], "versionstamp": null}
    ],
    "mutations": [
      {"type": "set", "key": ["users", "new-id"], "value": {"name": "New User"}}
    ]
  }'
```

---

## Queue Operations

### POST /api/queue/enqueue

Add a message to the queue.

#### Request

```http
POST /keyval/api/queue/enqueue
Content-Type: application/json

{
  "value": { "task": "send-email", "to": "user@example.com" },
  "options": {
    "delay": 5000,
    "backoffSchedule": [1000, 5000, 10000],
    "keysIfUndelivered": [["failed-tasks", "email-123"]]
  }
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `value` | `any` | Yes | Message payload (JSON-serializable) |
| `options.delay` | `number` | No | Delay in ms before message becomes available |
| `options.backoffSchedule` | `number[]` | No | Retry backoff schedule in ms (default: `[1000, 5000, 10000]`) |
| `options.keysIfUndelivered` | `KvKey[]` | No | Keys to store the value at if delivery fails after all retries |

#### Response

```json
{
  "ok": true,
  "id": "01J9X3K2M5N7P8Q9R0S1T2V3W4"
}
```

**Status:** `200 OK`

#### Examples

```bash
# Simple enqueue
curl -X POST http://localhost:8000/keyval/api/queue/enqueue \
  -H "Content-Type: application/json" \
  -d '{"value": {"task": "send-email", "to": "user@example.com"}}'

# Enqueue with 10 second delay
curl -X POST http://localhost:8000/keyval/api/queue/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "value": {"task": "reminder"},
    "options": {"delay": 10000}
  }'

# Enqueue with retry schedule and DLQ fallback
curl -X POST http://localhost:8000/keyval/api/queue/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "value": {"task": "webhook", "url": "https://api.example.com/hook"},
    "options": {
      "backoffSchedule": [1000, 5000, 30000],
      "keysIfUndelivered": [["failed-webhooks", "hook-123"]]
    }
  }'
```

---

### GET /api/queue/listen

SSE stream for receiving messages continuously (auto-dequeue).

#### Request

```http
GET /keyval/api/queue/listen
Accept: text/event-stream
```

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: message
id: 01J9X3K2M5N7P8Q9R0S1T2V3W4
data: {"id":"01J9X3K2M5N7P8Q9R0S1T2V3W4","value":{"task":"send-email"},"attempts":1}

event: ping
data:

event: message
id: 01J9X3K2M5N7P8Q9R0S1T2V3W5
data: {"id":"01J9X3K2M5N7P8Q9R0S1T2V3W5","value":{"task":"another"},"attempts":1}
```

**Event Types:**
- `message` - New message available (data: JSON message object)
- `ping` - Heartbeat to keep connection alive

#### Example

```bash
curl -N http://localhost:8000/keyval/api/queue/listen
```

```javascript
const eventSource = new EventSource("/keyval/api/queue/listen");

eventSource.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  console.log("Received:", msg.value);

  // Process the message, then ack or nack
  fetch("/keyval/api/queue/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: msg.id }),
  });
});
```

---

### GET /api/queue/poll

Poll for a single message (one-shot dequeue).

#### Request

```http
GET /keyval/api/queue/poll
```

#### Response (Message Available)

```json
{
  "message": {
    "id": "01J9X3K2M5N7P8Q9R0S1T2V3W4",
    "value": { "task": "send-email" },
    "attempts": 1
  }
}
```

#### Response (Queue Empty)

```json
{
  "message": null
}
```

**Status:** `200 OK`

#### Example

```bash
curl http://localhost:8000/keyval/api/queue/poll
```

---

### POST /api/queue/ack

Acknowledge successful processing of a message.

#### Request

```http
POST /keyval/api/queue/ack
Content-Type: application/json

{
  "id": "01J9X3K2M5N7P8Q9R0S1T2V3W4"
}
```

#### Response

```json
{
  "ok": true
}
```

**Status:** `200 OK`

**Error Response:**

```json
{
  "error": "id must be a non-empty string"
}
```

**Status:** `400 Bad Request`

#### Example

```bash
curl -X POST http://localhost:8000/keyval/api/queue/ack \
  -H "Content-Type: application/json" \
  -d '{"id": "01J9X3K2M5N7P8Q9R0S1T2V3W4"}'
```

---

### POST /api/queue/nack

Reject a message for retry. If retries are exhausted, the message goes to DLQ.

#### Request

```http
POST /keyval/api/queue/nack
Content-Type: application/json

{
  "id": "01J9X3K2M5N7P8Q9R0S1T2V3W4"
}
```

#### Response

```json
{
  "ok": true
}
```

**Status:** `200 OK`

#### Example

```bash
curl -X POST http://localhost:8000/keyval/api/queue/nack \
  -H "Content-Type: application/json" \
  -d '{"id": "01J9X3K2M5N7P8Q9R0S1T2V3W4"}'
```

---

### GET /api/queue/stats

Get queue statistics.

#### Request

```http
GET /keyval/api/queue/stats
```

#### Response

```json
{
  "pending": 10,
  "processing": 3,
  "dlq": 2,
  "total": 15
}
```

**Status:** `200 OK`

**Fields:**
- `pending`: Messages waiting to be processed
- `processing`: Messages currently being processed (locked)
- `dlq`: Messages in the dead letter queue
- `total`: Total messages across all states

#### Example

```bash
curl http://localhost:8000/keyval/api/queue/stats
```

---

## Dead Letter Queue (DLQ)

### GET /api/queue/dlq

List messages in the dead letter queue.

#### Request

```http
GET /keyval/api/queue/dlq?limit=50&offset=0
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | `number` | `100` | Max messages (max: 1000) |
| `offset` | `number` | `0` | Offset for pagination |

#### Response

```json
[
  {
    "id": "...",
    "originalId": "...",
    "value": { "task": "send-email" },
    "attempts": 3,
    "errorMessage": "Connection timeout",
    "originalCreatedAt": 1234567890000,
    "failedAt": 1234567900000
  }
]
```

**Status:** `200 OK`

#### Example

```bash
curl "http://localhost:8000/keyval/api/queue/dlq?limit=50"
```

---

### GET /api/queue/dlq/:id

Get a specific DLQ message.

#### Request

```http
GET /keyval/api/queue/dlq/01J9X3K2M5N7P8Q9R0S1T2V3W4
```

#### Response

```json
{
  "id": "...",
  "originalId": "...",
  "value": { "task": "send-email" },
  "attempts": 3,
  "errorMessage": "Connection timeout",
  "originalCreatedAt": 1234567890000,
  "failedAt": 1234567900000
}
```

**Status:** `200 OK`

**Error Response:**

```json
{
  "error": "Message not found in DLQ"
}
```

**Status:** `404 Not Found`

---

### POST /api/queue/dlq/:id/requeue

Requeue a DLQ message for reprocessing.

#### Request

```http
POST /keyval/api/queue/dlq/01J9X3K2M5N7P8Q9R0S1T2V3W4/requeue
```

#### Response (Success)

```json
{
  "ok": true,
  "newId": "01J9X3K2M5N7P8Q9R0S1T2V3W5"
}
```

**Status:** `200 OK`

#### Response (Not Found)

```json
{
  "ok": false,
  "error": "Message not found in DLQ"
}
```

**Status:** `404 Not Found`

---

### DELETE /api/queue/dlq/:id

Delete a specific DLQ message.

#### Request

```http
DELETE /keyval/api/queue/dlq/01J9X3K2M5N7P8Q9R0S1T2V3W4
```

#### Response

```json
{
  "ok": true
}
```

**Status:** `200 OK`

---

### DELETE /api/queue/dlq

Purge all DLQ messages.

#### Request

```http
DELETE /keyval/api/queue/dlq
```

#### Response

```json
{
  "deletedCount": 42
}
```

**Status:** `200 OK`

---

## Watch (SSE)

### GET /api/watch

Watch specific keys for changes via Server-Sent Events.

#### Request

```http
GET /keyval/api/watch?keys=users/123,config/theme&initial=true
Accept: text/event-stream
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `keys` | `string` | (required) | Comma-separated key paths |
| `initial` | `boolean` | `true` | Emit initial values on first event |

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream

event: change
data: [{"key":["users","123"],"value":{"name":"Alice"},"versionstamp":"00000000000000010000"}]

event: ping
data:

event: change
data: [{"key":["users","123"],"value":{"name":"Alice Updated"},"versionstamp":"00000000000000020000"}]
```

**Event Types:**
- `change` - One or more keys changed (data: JSON array of entries)
- `ping` - Heartbeat to keep connection alive

**Error Response:**

```json
{
  "error": "Missing 'keys' query parameter"
}
```

**Status:** `400 Bad Request`

#### Examples

```bash
# Watch a single key
curl -N "http://localhost:8000/keyval/api/watch?keys=users/123"

# Watch multiple keys
curl -N "http://localhost:8000/keyval/api/watch?keys=users/123,config/theme"

# Watch without initial values
curl -N "http://localhost:8000/keyval/api/watch?keys=users/123&initial=false"
```

```javascript
const eventSource = new EventSource("/keyval/api/watch?keys=users/123,config/theme");

eventSource.addEventListener("change", (event) => {
  const entries = JSON.parse(event.data);
  for (const entry of entries) {
    console.log("Changed:", entry.key, "->", entry.value);
  }
});

eventSource.addEventListener("ping", () => {
  // Connection is alive
});
```

---

### GET /api/watch/poll

Poll for key changes (single request, no streaming).

#### Request

```http
GET /keyval/api/watch/poll?keys=users/123,posts/456&versionstamps=00000000000000010000,00000000000000020000
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `keys` | `string` | (required) | Comma-separated key paths |
| `versionstamps` | `string` | - | Known versionstamps (comma-separated, one per key) |

#### Response

```json
{
  "entries": [
    {
      "key": ["users", "123"],
      "value": { "name": "Alice Updated" },
      "versionstamp": "00000000000000030000"
    }
  ],
  "versionstamps": ["00000000000000030000", "00000000000000020000"]
}
```

**Status:** `200 OK`

> **Note:** `entries` only contains keys that changed since the provided `versionstamps`. Pass the returned `versionstamps` in subsequent requests.

#### Examples

```bash
# Initial check (returns current values)
curl "http://localhost:8000/keyval/api/watch/poll?keys=users/123,posts/456"

# Subsequent check (only returns changes)
curl "http://localhost:8000/keyval/api/watch/poll?keys=users/123,posts/456&versionstamps=00000000000000010000,00000000000000020000"
```

---

### GET /api/watch/prefix

Watch all keys under a prefix via SSE.

#### Request

```http
GET /keyval/api/watch/prefix?prefix=users&initial=true&limit=100
Accept: text/event-stream
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | (required) | Key prefix to watch |
| `initial` | `boolean` | `true` | Emit initial values on first event |
| `limit` | `number` | `100` | Max keys to watch (max: 1000) |

#### Response

```http
event: change
data: [{"key":["users","001"],"value":{"name":"Alice"},"versionstamp":"00000000000000010000"}]

event: change
data: [{"key":["users","002"],"value":null,"versionstamp":null}]
```

> **Note:** When `value` is `null` and `versionstamp` is `null`, it means the key was deleted.

#### Example

```bash
curl -N "http://localhost:8000/keyval/api/watch/prefix?prefix=users&limit=50"
```

---

### GET /api/watch/prefix/poll

Poll for prefix-based changes (single request).

#### Request

```http
GET /keyval/api/watch/prefix/poll?prefix=users&versionstamps=users/001:00000000000000010000,users/002:00000000000000020000
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | (required) | Key prefix |
| `versionstamps` | `string` | - | Map of versionstamps (format: `key1:vs1,key2:vs2`) |
| `limit` | `number` | `100` | Max keys (max: 1000) |

#### Response

```json
{
  "entries": [
    {
      "key": ["users", "001"],
      "value": { "name": "Alice Updated" },
      "versionstamp": "00000000000000030000"
    }
  ],
  "versionstamps": "users/001:00000000000000030000,users/002:00000000000000020000"
}
```

**Status:** `200 OK`

---

## Full-Text Search

### POST /api/indexes

Create an FTS5 index for text search on specific fields.

#### Request

```http
POST /keyval/api/indexes
Content-Type: application/json

{
  "prefix": ["products"],
  "options": {
    "fields": ["name", "description", "category"],
    "tokenize": "porter"
  }
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prefix` | `KvKey` | Yes | Key prefix to index |
| `options.fields` | `string[]` | Yes | Fields to index (JSON paths) |
| `options.tokenize` | `string` | No | Tokenizer: `"unicode61"` (default), `"porter"`, `"ascii"` |

**Tokenizers:**

| Tokenizer | Description |
|-----------|-------------|
| `unicode61` | Unicode tokenization (default) - supports international characters |
| `porter` | Porter Stemming - normalizes words to roots (e.g., "running" -> "run") |
| `ascii` | ASCII tokenization - basic ASCII characters only |

#### Response

```json
{
  "ok": true
}
```

**Status:** `200 OK`

**Error Response:**

```json
{
  "error": "options.fields must be a non-empty array"
}
```

**Status:** `400 Bad Request`

> **Note:** An FTS index is required before searching. Each prefix can have only one index. Creating a new index for the same prefix replaces the previous one.

#### Examples

```bash
# Create simple index
curl -X POST http://localhost:8000/keyval/api/indexes \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["products"],
    "options": {"fields": ["name", "description", "category"]}
  }'

# Create index with Porter Stemming
curl -X POST http://localhost:8000/keyval/api/indexes \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["posts"],
    "options": {"fields": ["title", "content"], "tokenize": "porter"}
  }'
```

---

### GET /api/indexes

List all FTS indexes.

#### Request

```http
GET /keyval/api/indexes
```

#### Response

```json
[
  {
    "prefix": ["products"],
    "fields": ["name", "description", "category"],
    "tokenize": "unicode61"
  },
  {
    "prefix": ["posts"],
    "fields": ["title", "content"],
    "tokenize": "porter"
  }
]
```

**Status:** `200 OK`

---

### DELETE /api/indexes

Remove an FTS index.

#### Request

```http
DELETE /keyval/api/indexes?prefix=products
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefix` | `string` | Yes | Prefix of the index to remove (format: `part1/part2`) |

#### Response

```json
{
  "ok": true
}
```

**Status:** `200 OK`

---

### GET /api/search

Simple full-text search via query parameters.

#### Request

```http
GET /keyval/api/search?prefix=products&query=smartphone&limit=10
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | (required) | Prefix of the FTS index |
| `query` | `string` | (required) | Search text |
| `limit` | `number` | `100` | Max results (max: 1000) |

#### Response

```json
[
  {
    "key": ["products", "123"],
    "value": {
      "name": "Smartphone XYZ",
      "description": "High-end smartphone with advanced features",
      "price": 999.99
    },
    "versionstamp": "00000000000000010000"
  }
]
```

**Status:** `200 OK`

> **Note:** Results are ordered by FTS5 relevance ranking.

#### Example

```bash
curl "http://localhost:8000/keyval/api/search?prefix=products&query=smartphone&limit=10"
```

---

### POST /api/search

Advanced full-text search with where filters.

#### Request

```http
POST /keyval/api/search
Content-Type: application/json

{
  "prefix": ["products"],
  "query": "smartphone",
  "options": {
    "limit": 50,
    "where": {
      "price": { "$lt": 500 },
      "inStock": { "$eq": true }
    }
  }
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prefix` | `KvKey` | Yes | FTS index prefix |
| `query` | `string` | Yes | Search text |
| `options.limit` | `number` | No | Max results (default: 100, max: 1000) |
| `options.where` | `KvWhereFilter` | No | Additional structured filter |

> **Note:** FTS is applied first (using the index), then the `where` filter is applied to the results. This combines efficient text search with structured filtering.

#### Response

```json
[
  {
    "key": ["products", "789"],
    "value": {
      "name": "Budget Smartphone",
      "description": "Affordable smartphone",
      "price": 299.99,
      "inStock": true
    },
    "versionstamp": "00000000000000030000"
  }
]
```

**Status:** `200 OK`

#### Examples

```bash
# Search with price filter
curl -X POST http://localhost:8000/keyval/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["products"],
    "query": "phone",
    "options": {"where": {"price": {"$lt": 100}}}
  }'

# Search with complex filters
curl -X POST http://localhost:8000/keyval/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["products"],
    "query": "laptop gaming",
    "options": {
      "where": {
        "$and": [
          {"inStock": {"$eq": true}},
          {"price": {"$between": [500, 2000]}},
          {"rating": {"$gte": 4}}
        ]
      }
    }
  }'
```

---

## Metrics

### GET /api/metrics

Get metrics in JSON format.

#### Request

```http
GET /keyval/api/metrics
```

#### Response

```json
{
  "operations": {
    "get": { "count": 1234, "errors": 5 },
    "set": { "count": 567, "errors": 2 },
    "delete": { "count": 89, "errors": 0 },
    "list": { "count": 456, "errors": 1 },
    "atomic": { "count": 234, "errors": 3 }
  },
  "queue": {
    "pending": 10,
    "processing": 3,
    "dlq": 2,
    "total": 15
  },
  "storage": {
    "entries": 5432,
    "sizeBytes": 1048576
  }
}
```

**Status:** `200 OK`

**Fields:**
- `operations`: Counters by operation type (count and errors)
- `queue`: Current queue state
- `storage.entries`: Total non-expired entries
- `storage.sizeBytes`: Total storage size in bytes

#### Example

```bash
curl http://localhost:8000/keyval/api/metrics
```

---

### GET /api/metrics/prometheus

Get metrics in Prometheus text format.

#### Request

```http
GET /keyval/api/metrics/prometheus
```

#### Response

```
# HELP keyval_operations_total Total operations by type
# TYPE keyval_operations_total counter
keyval_operations_total{operation="get"} 1234
keyval_operations_total{operation="set"} 567
keyval_operations_total{operation="delete"} 89

# HELP keyval_operation_errors_total Total errors by operation type
# TYPE keyval_operation_errors_total counter
keyval_operation_errors_total{operation="get"} 5
keyval_operation_errors_total{operation="set"} 2

# HELP keyval_queue_pending Pending messages in queue
# TYPE keyval_queue_pending gauge
keyval_queue_pending 10

# HELP keyval_queue_processing Messages being processed
# TYPE keyval_queue_processing gauge
keyval_queue_processing 3

# HELP keyval_queue_dlq Messages in dead letter queue
# TYPE keyval_queue_dlq gauge
keyval_queue_dlq 2

# HELP keyval_queue_total Total messages in queue
# TYPE keyval_queue_total gauge
keyval_queue_total 15

# HELP keyval_entries_total Total entries in store
# TYPE keyval_entries_total gauge
keyval_entries_total 5432

# HELP keyval_storage_bytes Storage size in bytes
# TYPE keyval_storage_bytes gauge
keyval_storage_bytes 1048576
```

**Content-Type:** `text/plain; version=0.0.4`

#### Example

```bash
curl http://localhost:8000/keyval/api/metrics/prometheus
```

---

## Limits and Validation

| Item | Limit | Description |
|------|-------|-------------|
| Key depth | 20 parts | Maximum parts in a key array |
| Key part types | Restricted | `string`, `number`, `bigint`, `boolean`, `Uint8Array` |
| Batch get | 1000 keys | Maximum keys per batch request |
| List limit | 1000 | Maximum entries returned per list call |
| Default limit | 100 | Default value for `limit` parameter |
| TTL max (`expiresIn`) | 2147483647 ms | Approximately 24.8 days |
| Watch keys | 1000 | Maximum keys watched simultaneously |
| Watch prefix | 1000 | Maximum keys returned per prefix watch |
| DLQ list limit | 1000 | Maximum DLQ messages returned |

---

## TypeScript Types

```typescript
// Core
type KvKeyPart = bigint | boolean | number | string | Uint8Array;
type KvKey = KvKeyPart[];
interface KvEntry<T> { key: KvKey; value: T | null; versionstamp: string | null }

// Atomic
interface KvCheck { key: KvKey; versionstamp: string | null }
type KvMutationType = "append" | "delete" | "max" | "min" | "prepend" | "set" | "sum";
interface KvMutation { key: KvKey; type: KvMutationType; value?: unknown; expiresIn?: number }
interface KvCommitResult { ok: true; versionstamp: string }
interface KvCommitError { ok: false }

// Queue
interface KvQueueMessage<T> { id: string; value: T; attempts: number }
interface KvEnqueueOptions { delay?: number; backoffSchedule?: number[]; keysIfUndelivered?: KvKey[] }

// Pagination
interface KvPaginateResult<T> { entries: KvEntry<T>[]; cursor: string | null; hasMore: boolean }

// FTS
type KvFtsTokenizer = "ascii" | "porter" | "unicode61";
interface KvCreateIndexOptions { fields: string[]; tokenize?: KvFtsTokenizer }
interface KvSearchOptions { limit?: number; where?: KvWhereFilter }
```

---

## Next Steps

- [Overview](concepts/overview.md) - Architecture and components
- [Keys and Entries](concepts/keys-and-entries.md) - Key structure and TTL
- [Atomic Operations](concepts/atomic-operations.md) - Concurrency control
- [Queues](concepts/queues.md) - Message queue and DLQ
- [Full-Text Search](concepts/full-text-search.md) - FTS indexes
- [Where Filters](guides/where-filters.md) - Filter operators
- [Configuration](guides/configuration.md) - Configuration reference
