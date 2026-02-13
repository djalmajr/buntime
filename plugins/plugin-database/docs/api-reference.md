# API Reference

Complete reference for the plugin-database API.

## Base URL

All routes are served under the plugin base path:

```
/database/api/*
```

## Authentication

Database API routes **do NOT** require authentication by default. Protect them via the authn plugin or network-level controls in production.

## Endpoints

### GET /api/adapters

Returns the list of configured adapter types and which one is the default.

#### Request

```http
GET /database/api/adapters
```

#### Response

```json
{
  "adapters": ["libsql", "sqlite"],
  "default": "libsql"
}
```

**Status:** `200 OK`

**Fields:**
- `adapters`: Array of available `AdapterType` strings
- `default`: The default adapter type used when no `?type=` is specified

#### Example

```bash
curl http://localhost:8000/database/api/adapters
```

---

### GET /api/tenants

List all tenants for a given adapter type.

#### Request

```http
GET /database/api/tenants?type=libsql
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `type` | `AdapterType` | Adapter type to query | Default adapter |

#### Response

```json
{
  "tenants": ["default", "acme-corp", "contoso"],
  "type": "libsql"
}
```

**Status:** `200 OK`

**Fields:**
- `tenants`: Array of tenant ID strings
- `type`: The adapter type that was queried

#### Example

```bash
# List tenants on default adapter
curl http://localhost:8000/database/api/tenants

# List tenants on sqlite adapter
curl "http://localhost:8000/database/api/tenants?type=sqlite"
```

---

### POST /api/tenants

Create a new tenant.

#### Request

```http
POST /database/api/tenants
Content-Type: application/json

{
  "id": "acme-corp",
  "type": "libsql"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Tenant identifier |
| `type` | `AdapterType` | No | Adapter type (uses default if omitted) |

#### Response

```json
{
  "ok": true,
  "id": "acme-corp",
  "type": "libsql"
}
```

**Status:** `201 Created`

**Error Response (Missing ID):**

```json
{
  "error": "Missing or invalid tenant id"
}
```

**Status:** `400 Bad Request`

#### What Happens Per Adapter

| Adapter | Tenant Creation Action |
|---------|----------------------|
| SQLite | New `.db` file in `baseDir` |
| LibSQL | Namespace via Admin API (`POST /v1/namespaces/{id}/create`) |
| PostgreSQL | `CREATE SCHEMA IF NOT EXISTS {id}` |
| MySQL | `CREATE DATABASE IF NOT EXISTS {id}` |

#### Example

```bash
curl -X POST http://localhost:8000/database/api/tenants \
  -H "Content-Type: application/json" \
  -d '{"id": "acme-corp"}'
```

---

### DELETE /api/tenants/:id

Delete a tenant and all its data.

#### Request

```http
DELETE /database/api/tenants/acme-corp?type=libsql
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Tenant identifier to delete |

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `type` | `AdapterType` | Adapter type | Default adapter |

#### Response

```json
{
  "ok": true
}
```

**Status:** `200 OK`

#### What Happens Per Adapter

| Adapter | Tenant Deletion Action |
|---------|----------------------|
| SQLite | Truncates `.db` file |
| LibSQL | `DELETE /v1/namespaces/{id}` via Admin API |
| PostgreSQL | `DROP SCHEMA IF EXISTS {id} CASCADE` |
| MySQL | `DROP DATABASE IF EXISTS {id}` |

#### Example

```bash
curl -X DELETE "http://localhost:8000/database/api/tenants/acme-corp?type=libsql"
```

---

### GET /api/tables

List tables in the database.

#### Request

```http
GET /database/api/tables?type=sqlite&tenant=acme-corp
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `type` | `AdapterType` | Adapter type | Default adapter |
| `tenant` | `string` | Tenant ID | Root adapter (no tenant) |

#### Response

```json
{
  "tables": [
    { "name": "users", "type": "table" },
    { "name": "sessions", "type": "table" },
    { "name": "active_users", "type": "view" }
  ],
  "type": "sqlite"
}
```

**Status:** `200 OK`

**Fields:**
- `tables`: Array of table objects
  - `name`: Table or view name
  - `type`: `"table"` or `"view"`
- `type`: The adapter type that was queried

#### Table Discovery Per Adapter

| Adapter | Query Used |
|---------|-----------|
| SQLite / LibSQL | `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view')` |
| PostgreSQL | `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public'` |
| MySQL | `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE()` |

#### Example

```bash
# List tables on default adapter
curl http://localhost:8000/database/api/tables

# List tables for a specific tenant
curl "http://localhost:8000/database/api/tables?type=libsql&tenant=acme-corp"
```

---

### GET /api/tables/:name/schema

Get column schema for a table.

#### Request

```http
GET /database/api/tables/users/schema?type=sqlite
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Table name |

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `type` | `AdapterType` | Adapter type | Default adapter |
| `tenant` | `string` | Tenant ID | Root adapter |

#### Response

```json
{
  "table": "users",
  "type": "sqlite",
  "columns": [
    { "name": "id", "type": "TEXT", "nullable": false, "pk": true },
    { "name": "email", "type": "TEXT", "nullable": false, "pk": false },
    { "name": "name", "type": "TEXT", "nullable": true, "pk": false },
    { "name": "created_at", "type": "INTEGER", "nullable": false, "pk": false }
  ]
}
```

**Status:** `200 OK`

**Fields:**
- `table`: Table name
- `type`: Adapter type
- `columns`: Array of column objects
  - `name`: Column name
  - `type`: Column data type
  - `nullable`: Whether the column allows NULL
  - `pk`: Whether the column is a primary key

#### Example

```bash
curl http://localhost:8000/database/api/tables/users/schema
```

---

### GET /api/tables/:name/rows

Query table data with pagination.

#### Request

```http
GET /database/api/tables/users/rows?limit=50&offset=0&type=sqlite
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Table name |

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | `number` | Max rows to return (capped at 1000) | `100` |
| `offset` | `number` | Row offset for pagination | `0` |
| `type` | `AdapterType` | Adapter type | Default adapter |
| `tenant` | `string` | Tenant ID | Root adapter |

#### Response

```json
{
  "table": "users",
  "rows": [
    { "id": "01912345-6789-7abc-def0-123456789abc", "email": "alice@example.com", "name": "Alice" },
    { "id": "01912345-6789-7abc-def0-223456789abc", "email": "bob@example.com", "name": "Bob" }
  ],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```

**Status:** `200 OK`

**Fields:**
- `table`: Table name
- `rows`: Array of row objects
- `total`: Total row count in table
- `limit`: Applied limit
- `offset`: Applied offset

**Note:** For SQLite/LibSQL, BLOB columns are automatically cast to TEXT for display.

#### Example

```bash
# First page
curl "http://localhost:8000/database/api/tables/users/rows?limit=50"

# Second page
curl "http://localhost:8000/database/api/tables/users/rows?limit=50&offset=50"
```

---

### POST /api/query

Execute raw SQL against the database. Used by the Studio UI.

#### Request

```http
POST /database/api/query
Content-Type: application/json

{
  "sql": "SELECT * FROM users WHERE email LIKE ?",
  "type": "sqlite",
  "tenant": "acme-corp"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sql` | `string` | Yes | SQL query to execute |
| `type` | `AdapterType` | No | Adapter type (uses default) |
| `tenant` | `string` | No | Tenant ID (uses root adapter) |

#### Response

```json
{
  "rows": [
    { "id": "01912345-...", "email": "alice@example.com" }
  ],
  "rowCount": 1,
  "duration": 3
}
```

**Status:** `200 OK`

**Fields:**
- `rows`: Array of result rows
- `rowCount`: Number of rows returned
- `duration`: Query execution time in milliseconds

**Error Response (Missing SQL):**

```json
{
  "error": "Missing or invalid SQL query"
}
```

**Status:** `400 Bad Request`

#### Example

```bash
# Simple query
curl -X POST http://localhost:8000/database/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT COUNT(*) as count FROM users"}'

# Query specific adapter and tenant
curl -X POST http://localhost:8000/database/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM orders LIMIT 10", "type": "libsql", "tenant": "acme-corp"}'
```

---

### GET /api/health

Health check for database adapters. Executes `SELECT 1` on each adapter.

#### Request

```http
GET /database/api/health?type=sqlite
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `type` | `AdapterType` | Check specific adapter | All adapters |

#### Response (All Adapters)

```json
{
  "status": "healthy",
  "adapters": {
    "libsql": "healthy",
    "sqlite": "healthy"
  }
}
```

**Status:** `200 OK`

**Status Values:**
- `"healthy"` - All adapters responding
- `"degraded"` - Some adapters failing

#### Response (Specific Adapter)

```json
{
  "status": "healthy",
  "type": "sqlite"
}
```

**Status:** `200 OK`

#### Error Response

```json
{
  "status": "unhealthy",
  "error": "Connection refused"
}
```

**Status:** `500 Internal Server Error`

#### Example

```bash
# Check all adapters
curl http://localhost:8000/database/api/health

# Check specific adapter
curl "http://localhost:8000/database/api/health?type=libsql"
```

---

### POST /api/pipeline

HRANA protocol pipeline endpoint. Used by `@libsql/client` in workers to execute SQL through the runtime.

See [HRANA Protocol](concepts/hrana.md) for full protocol details.

#### Request

```http
POST /database/api/pipeline
Content-Type: application/json
x-database-adapter: libsql
x-database-namespace: acme-corp

{
  "baton": null,
  "requests": [
    {
      "type": "execute",
      "stmt": {
        "sql": "SELECT * FROM users LIMIT 10",
        "want_rows": true
      }
    }
  ]
}
```

**Headers:**

| Header | Description |
|--------|-------------|
| `x-database-adapter` | Target adapter type (`libsql`, `sqlite`, `postgres`, `mysql`) |
| `x-database-namespace` | Target tenant/namespace ID |

**Body:** See [HRANA Pipeline Request](concepts/hrana.md#pipeline-request-body).

#### Response

```json
{
  "baton": null,
  "base_url": null,
  "results": [
    {
      "type": "ok",
      "result": {
        "cols": [
          { "name": "id", "decltype": null },
          { "name": "email", "decltype": null }
        ],
        "rows": [
          [
            { "type": "text", "value": "01912345-..." },
            { "type": "text", "value": "alice@example.com" }
          ]
        ],
        "affected_row_count": 0,
        "last_insert_rowid": null,
        "rows_read": 1,
        "rows_written": 0
      }
    }
  ]
}
```

**Status:** `200 OK`

**Fields:**
- `baton`: Session token for transaction continuity (null if no active session)
- `base_url`: Redirect URL for subsequent requests (always null)
- `results`: Array of results matching each request

#### Error Response

```json
{
  "baton": null,
  "base_url": null,
  "results": [
    {
      "type": "error",
      "error": {
        "code": "SQLITE_ERROR",
        "message": "no such table: nonexistent"
      }
    }
  ]
}
```

#### Example

```bash
curl -X POST http://localhost:8000/database/api/pipeline \
  -H "Content-Type: application/json" \
  -H "x-database-adapter: sqlite" \
  -d '{
    "baton": null,
    "requests": [
      {
        "type": "execute",
        "stmt": { "sql": "SELECT 1 as ping", "want_rows": true }
      }
    ]
  }'
```

---

### WebSocket: /api/ws

HRANA WebSocket endpoint for persistent connections.

#### Upgrade Request

```http
GET /database/api/ws
Upgrade: websocket
x-database-adapter: libsql
x-database-namespace: acme-corp
```

**Headers:**

| Header | Description |
|--------|-------------|
| `Upgrade` | Must be `websocket` |
| `x-database-adapter` | Target adapter type |
| `x-database-namespace` | Target tenant/namespace ID |

#### WebSocket Message Format

**Request:**

```json
{
  "request_id": 1,
  "request": {
    "type": "execute",
    "stmt": {
      "sql": "SELECT * FROM users",
      "want_rows": true
    }
  }
}
```

**Response:**

```json
{
  "request_id": 1,
  "response": {
    "type": "ok",
    "result": {
      "cols": [{ "name": "id", "decltype": null }],
      "rows": [[{ "type": "text", "value": "..." }]],
      "affected_row_count": 0,
      "last_insert_rowid": null,
      "rows_read": 1,
      "rows_written": 0
    }
  }
}
```

**Fields:**
- `request_id`: Client-assigned ID to correlate responses
- `request`/`response`: HRANA stream request/result objects

---

## Errors

### Error Response Format

```json
{
  "error": "Error message"
}
```

### Common Errors

#### 400 Bad Request

```json
{
  "error": "Missing or invalid tenant id"
}
```

Cause: Invalid or missing required parameters.

#### 500 Internal Server Error

```json
{
  "error": "Service not initialized"
}
```

Cause: Plugin has not finished initialization.

```json
{
  "error": "Adapter type \"postgres\" not configured. Available: libsql, sqlite"
}
```

Cause: Requested adapter type is not configured.

---

## TypeScript Types

### DatabaseService

```typescript
interface DatabaseService {
  getAdapter(type?: AdapterType, tenantId?: string): Promise<DatabaseAdapter>;
  getRootAdapter(type?: AdapterType): DatabaseAdapter;
  createTenant(tenantId: string, type?: AdapterType): Promise<void>;
  deleteTenant(tenantId: string, type?: AdapterType): Promise<void>;
  listTenants(type?: AdapterType): Promise<string[]>;
  getDefaultType(): AdapterType;
  getAvailableTypes(): AdapterType[];
}
```

### DatabaseAdapter

```typescript
interface DatabaseAdapter {
  readonly type: AdapterType;
  readonly tenantId: string | null;

  execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]>;
  executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null>;
  batch(statements: Statement[]): Promise<void>;
  transaction<T>(fn: (tx: TransactionAdapter) => Promise<T>): Promise<T>;
  getTenant(tenantId: string): Promise<DatabaseAdapter>;
  createTenant(tenantId: string): Promise<void>;
  deleteTenant(tenantId: string): Promise<void>;
  listTenants(): Promise<string[]>;
  close(): Promise<void>;
  getRawClient(): unknown;
}
```

### AdapterType

```typescript
type AdapterType = "libsql" | "mysql" | "postgres" | "sqlite";
```

### Statement

```typescript
interface Statement {
  sql: string;
  args?: unknown[];
}
```

### TransactionAdapter

```typescript
interface TransactionAdapter {
  execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]>;
  executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null>;
}
```

---

## Client SDK Example

### JavaScript/TypeScript

```typescript
class DatabaseClient {
  constructor(private baseUrl: string) {}

  async getAdapters() {
    const res = await fetch(`${this.baseUrl}/database/api/adapters`);
    return res.json();
  }

  async listTenants(type?: string) {
    const params = type ? `?type=${type}` : "";
    const res = await fetch(`${this.baseUrl}/database/api/tenants${params}`);
    return res.json();
  }

  async createTenant(id: string, type?: string) {
    const res = await fetch(`${this.baseUrl}/database/api/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, type }),
    });
    return res.json();
  }

  async deleteTenant(id: string, type?: string) {
    const params = type ? `?type=${type}` : "";
    const res = await fetch(`${this.baseUrl}/database/api/tenants/${id}${params}`, {
      method: "DELETE",
    });
    return res.json();
  }

  async listTables(type?: string, tenant?: string) {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (tenant) params.set("tenant", tenant);
    const query = params.toString() ? `?${params}` : "";
    const res = await fetch(`${this.baseUrl}/database/api/tables${query}`);
    return res.json();
  }

  async getTableSchema(name: string, type?: string) {
    const params = type ? `?type=${type}` : "";
    const res = await fetch(`${this.baseUrl}/database/api/tables/${name}/schema${params}`);
    return res.json();
  }

  async getTableRows(name: string, options: { limit?: number; offset?: number; type?: string; tenant?: string } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    if (options.type) params.set("type", options.type);
    if (options.tenant) params.set("tenant", options.tenant);
    const query = params.toString() ? `?${params}` : "";
    const res = await fetch(`${this.baseUrl}/database/api/tables/${name}/rows${query}`);
    return res.json();
  }

  async query(sql: string, type?: string, tenant?: string) {
    const res = await fetch(`${this.baseUrl}/database/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, type, tenant }),
    });
    return res.json();
  }

  async health(type?: string) {
    const params = type ? `?type=${type}` : "";
    const res = await fetch(`${this.baseUrl}/database/api/health${params}`);
    return res.json();
  }
}

// Usage
const db = new DatabaseClient("http://localhost:8000");

// Check health
const health = await db.health();
console.log(health.status); // "healthy"

// List tables
const { tables } = await db.listTables("sqlite");
console.log(tables.map((t) => t.name));

// Execute query
const result = await db.query("SELECT COUNT(*) as count FROM users");
console.log(`Users: ${result.rows[0].count}`);

// Browse table data with pagination
const page1 = await db.getTableRows("users", { limit: 50, offset: 0 });
console.log(`Showing ${page1.rows.length} of ${page1.total}`);

// Multi-tenant operations
await db.createTenant("acme-corp", "libsql");
const tenants = await db.listTenants("libsql");
console.log(tenants.tenants); // ["default", "acme-corp"]
```

---

## Next Steps

- [Overview](concepts/overview.md) - Architecture and components
- [Adapters](concepts/adapters.md) - Adapter deep dive
- [HRANA Protocol](concepts/hrana.md) - HRANA protocol details
- [Configuration](guides/configuration.md) - Configuration reference
