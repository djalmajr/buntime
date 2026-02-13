# Where Filters

Where filters enable server-side filtering of KV entries during `list`, `delete`, and `search` operations. Filters are translated to SQL WHERE clauses using SQLite `json_extract()` functions.

## Syntax

Filters are JSON objects where keys are field names and values are operator expressions:

```json
// Full syntax
{ "field": { "$operator": "value" } }

// Shorthand (equivalent to $eq)
{ "field": "value" }
```

Multiple conditions on the same level are combined with AND:

```json
{
  "status": { "$eq": "active" },
  "age": { "$gte": 18 }
}
```

## Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Equal to | `{ "status": { "$eq": "active" } }` |
| `$ne` | Not equal to | `{ "status": { "$ne": "deleted" } }` |
| `$gt` | Greater than | `{ "age": { "$gt": 18 } }` |
| `$gte` | Greater than or equal | `{ "age": { "$gte": 18 } }` |
| `$lt` | Less than | `{ "price": { "$lt": 100 } }` |
| `$lte` | Less than or equal | `{ "price": { "$lte": 100 } }` |
| `$between` | Between two values (inclusive) | `{ "age": { "$between": [18, 65] } }` |

### Examples

```json
// Users older than 30
{ "age": { "$gt": 30 } }

// Products priced between 10 and 100 (inclusive)
{ "price": { "$between": [10, 100] } }

// Multiple operators on same field
{ "age": { "$gte": 18, "$lte": 65 } }
```

```bash
# List users older than 30
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{"prefix": ["users"], "where": {"age": {"$gt": 30}}}'
```

## Array Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$in` | Value is in array | `{ "status": { "$in": ["active", "pending"] } }` |
| `$nin` | Value is not in array | `{ "role": { "$nin": ["admin", "moderator"] } }` |

### Examples

```json
// Users with active or pending status
{ "status": { "$in": ["active", "pending"] } }

// Exclude admin users
{ "role": { "$nin": ["admin", "superadmin"] } }
```

```bash
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{"prefix": ["users"], "where": {"status": {"$in": ["active", "pending"]}}}'
```

## String Operators (Case-Sensitive)

| Operator | Description | Example |
|----------|-------------|---------|
| `$contains` | Contains substring | `{ "email": { "$contains": "@gmail" } }` |
| `$notContains` | Does not contain substring | `{ "name": { "$notContains": "test" } }` |
| `$startsWith` | Starts with prefix | `{ "code": { "$startsWith": "BR_" } }` |
| `$endsWith` | Ends with suffix | `{ "email": { "$endsWith": ".com" } }` |

## String Operators (Case-Insensitive)

| Operator | Description | Example |
|----------|-------------|---------|
| `$containsi` | Contains (case-insensitive) | `{ "name": { "$containsi": "john" } }` |
| `$notContainsi` | Not contains (case-insensitive) | `{ "tag": { "$notContainsi": "spam" } }` |
| `$startsWithi` | Starts with (case-insensitive) | `{ "title": { "$startsWithi": "the" } }` |
| `$endsWithi` | Ends with (case-insensitive) | `{ "domain": { "$endsWithi": ".COM" } }` |

### Examples

```json
// Gmail users (case-sensitive)
{ "email": { "$contains": "@gmail.com" } }

// Case-insensitive name search
{ "name": { "$containsi": "john" } }
// Matches: "John", "JOHN", "john", "Johnny"

// Files ending with .pdf (case-insensitive)
{ "filename": { "$endsWithi": ".pdf" } }
// Matches: "report.pdf", "Report.PDF", "doc.Pdf"
```

```bash
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{"prefix": ["users"], "where": {"name": {"$containsi": "john"}}}'
```

## Existence Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$null` | Value is null (`true`) or not null (`false`) | `{ "deletedAt": { "$null": true } }` |
| `$empty` | Value is empty (null, `""`, or `[]`) | `{ "tags": { "$empty": true } }` |
| `$notEmpty` | Value is not empty | `{ "description": { "$notEmpty": true } }` |

### Difference Between $null and $empty

| Operator | Matches |
|----------|---------|
| `$null: true` | `null`, field not present |
| `$empty: true` | `null`, `""`, `[]` |
| `$notEmpty: true` | Any non-null, non-empty value |

### Examples

```json
// Users without email
{ "email": { "$null": true } }

// Posts with tags
{ "tags": { "$notEmpty": true } }

// Users with empty bio
{ "bio": { "$empty": true } }
```

```bash
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{"prefix": ["users"], "where": {"email": {"$null": false}, "bio": {"$notEmpty": true}}}'
```

## Logical Operators

### $and

All conditions must be true:

```json
{
  "$and": [
    { "status": { "$eq": "active" } },
    { "age": { "$gte": 18 } },
    { "verified": { "$eq": true } }
  ]
}
```

> **Note:** Multiple conditions at the top level are implicitly AND-ed. Use `$and` explicitly when nesting with other logical operators.

### $or

At least one condition must be true:

```json
{
  "$or": [
    { "role": { "$eq": "admin" } },
    { "role": { "$eq": "moderator" } }
  ]
}
```

### $not

Negates a condition:

```json
{
  "$not": { "status": { "$eq": "banned" } }
}
```

### Combining Logical Operators

```json
{
  "$and": [
    { "status": { "$eq": "active" } },
    {
      "$or": [
        { "role": { "$eq": "admin" } },
        { "role": { "$eq": "moderator" } }
      ]
    },
    { "$not": { "suspended": { "$eq": true } } }
  ]
}
```

```bash
# Active users who are either admin or moderator and not suspended
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["users"],
    "where": {
      "$and": [
        {"status": {"$eq": "active"}},
        {"$or": [{"role": {"$eq": "admin"}}, {"role": {"$eq": "moderator"}}]},
        {"$not": {"suspended": {"$eq": true}}}
      ]
    }
  }'
```

## Nested Fields

Use dot notation to filter on nested object properties:

```json
// Entry value: { "details": { "price": 999, "manufacturer": { "country": "Japan" } } }

// Filter by nested field
{ "details.price": { "$gte": 500 } }

// Deeply nested field
{ "details.manufacturer.country": { "$eq": "Japan" } }
```

```bash
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["products"],
    "where": {"details.price": {"$between": [100, 500]}}
  }'
```

## Server-Side Timestamps ($now)

The `$now` placeholder resolves to `Date.now()` on the server at query time. This avoids clock skew between client and server.

### Basic Usage

```json
// Entries where expiresAt is in the past
{ "expiresAt": { "$lt": { "$now": true } } }

// Entries created in the future (shouldn't exist)
{ "createdAt": { "$gt": { "$now": true } } }
```

### With Offset

Add a millisecond offset to the current time:

```json
// Entries expiring within the next hour
{ "expiresAt": { "$lt": { "$now": true, "$offset": 3600000 } } }

// Entries created more than 24 hours ago
{ "createdAt": { "$lt": { "$now": true, "$offset": -86400000 } } }
```

Positive offset = future, negative offset = past.

### Examples

```bash
# Expired sessions
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["sessions"],
    "where": {"expiresAt": {"$lt": {"$now": true}}}
  }'

# Posts published in the last 24 hours
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["posts"],
    "where": {
      "publishedAt": {"$gt": {"$now": true, "$offset": -86400000}},
      "status": {"$eq": "published"}
    }
  }'

# Delete expired entries
curl -X DELETE http://localhost:8000/keyval/api/keys/sessions \
  -H "Content-Type: application/json" \
  -d '{"where": {"expiresAt": {"$lt": {"$now": true}}}}'
```

## Usage Contexts

Where filters can be used in the following operations:

### List with Filters (POST /api/keys/list)

```bash
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["users"],
    "limit": 50,
    "where": {"status": {"$eq": "active"}}
  }'
```

### Delete with Filters (DELETE /api/keys/*)

```bash
curl -X DELETE http://localhost:8000/keyval/api/keys/tasks \
  -H "Content-Type: application/json" \
  -d '{"where": {"status": "completed"}}'
```

### Batch Delete with Filters (POST /api/keys/delete-batch)

```bash
curl -X POST http://localhost:8000/keyval/api/keys/delete-batch \
  -H "Content-Type: application/json" \
  -d '{
    "keys": [["tasks"], ["jobs"]],
    "where": {"status": "completed"}
  }'
```

### Search with Filters (POST /api/search)

```bash
curl -X POST http://localhost:8000/keyval/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": ["products"],
    "query": "laptop",
    "options": {
      "where": {"price": {"$lt": 1000}, "inStock": {"$eq": true}}
    }
  }'
```

## Complete Operator Reference

| Category | Operator | Type | Description |
|----------|----------|------|-------------|
| **Comparison** | `$eq` | any | Equal to |
| | `$ne` | any | Not equal to |
| | `$gt` | number/string/$now | Greater than |
| | `$gte` | number/string/$now | Greater than or equal |
| | `$lt` | number/string/$now | Less than |
| | `$lte` | number/string/$now | Less than or equal |
| | `$between` | [min, max] | Between (inclusive) |
| **Array** | `$in` | array | Value in array |
| | `$nin` | array | Value not in array |
| **String (sensitive)** | `$contains` | string | Contains substring |
| | `$notContains` | string | Not contains |
| | `$startsWith` | string | Starts with |
| | `$endsWith` | string | Ends with |
| **String (insensitive)** | `$containsi` | string | Contains (case-insensitive) |
| | `$notContainsi` | string | Not contains (case-insensitive) |
| | `$startsWithi` | string | Starts with (case-insensitive) |
| | `$endsWithi` | string | Ends with (case-insensitive) |
| **Existence** | `$null` | boolean | Is null / is not null |
| | `$empty` | boolean | Is empty (null, "", []) |
| | `$notEmpty` | boolean | Is not empty |
| **Logical** | `$and` | array | All must be true |
| | `$or` | array | At least one true |
| | `$not` | object | Negation |
| **Timestamp** | `$now` | object | Server-side timestamp |

## Complex Filter Examples

### E-Commerce Product Search

```json
{
  "$and": [
    { "inStock": { "$eq": true } },
    { "price": { "$between": [100, 500] } },
    {
      "$or": [
        { "category": { "$eq": "electronics" } },
        { "category": { "$eq": "computers" } }
      ]
    },
    { "name": { "$notContainsi": "refurbished" } },
    { "rating": { "$gte": 4 } }
  ]
}
```

### User Management

```json
{
  "status": { "$eq": "active" },
  "email": { "$notEmpty": true },
  "lastLogin": { "$gt": { "$now": true, "$offset": -2592000000 } },
  "$not": { "role": { "$in": ["bot", "system"] } }
}
```

### Content Moderation

```json
{
  "$or": [
    { "flagCount": { "$gte": 5 } },
    {
      "$and": [
        { "flagCount": { "$gte": 3 } },
        { "createdAt": { "$lt": { "$now": true, "$offset": -86400000 } } }
      ]
    }
  ]
}
```

## Performance Considerations

Where filters perform a table scan with filtering via SQLite `json_extract()`. For frequent queries on large datasets, consider these alternatives:

### 1. Composite Keys

Include frequently filtered fields in the key structure:

```typescript
// Instead of filtering by status
await kv.set(["users", userId], { name: "Alice", status: "active" });
// List with: where: { status: { $eq: "active" } }

// Use composite keys
await kv.set(["users_by_status", "active", userId], userId);
// List with: prefix: ["users_by_status", "active"]  (no filter needed)
```

### 2. Full-Text Search

For text search, use FTS indexes instead of string operators:

```bash
# Slower: list + string filter
curl -X POST http://localhost:8000/keyval/api/keys/list \
  -d '{"prefix": ["posts"], "where": {"content": {"$containsi": "react"}}}'

# Faster: FTS search
curl "http://localhost:8000/keyval/api/search?prefix=posts&query=react"
```

### 3. Always Use Limits

Always set a `limit` to avoid loading excessive data:

```json
{
  "prefix": ["users"],
  "limit": 100,
  "where": { "status": { "$eq": "active" } }
}
```

## Next Steps

- [Full-Text Search](../concepts/full-text-search.md) - FTS for text queries
- [Keys and Entries](../concepts/keys-and-entries.md) - Key design patterns
- [Configuration](configuration.md) - Plugin configuration
- [API Reference](../api-reference.md) - Complete endpoint reference
