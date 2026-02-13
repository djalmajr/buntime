# Adapters

Deep dive on the database adapter system. Each adapter implements the `DatabaseAdapter` interface, providing a unified API regardless of the underlying database engine.

## Adapter Interface

All adapters implement:

```typescript
interface DatabaseAdapter {
  readonly type: AdapterType;
  readonly tenantId: string | null;

  execute<T>(sql: string, args?: unknown[]): Promise<T[]>;
  executeOne<T>(sql: string, args?: unknown[]): Promise<T | null>;
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

## Adapter Classes

There are two implementation classes:

| Class | Adapter Types | Driver |
|-------|--------------|--------|
| `BunSqlAdapter` | `sqlite`, `postgres`, `mysql` | Bun's native `SQL` API |
| `LibSqlAdapter` | `libsql` | `@libsql/client/http` |

---

## SQLite (Bun SQL)

Local file-based SQLite using Bun's built-in SQL driver.

### Configuration

```yaml
adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
    default: true
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `"sqlite"` | **Required** | Adapter type |
| `baseDir` | `string` | - | Base directory for SQLite files |
| `url` | `string` | - | Database file URL (e.g., `sqlite://path/to/db.db`) |
| `default` | `boolean` | `false` | Mark as default adapter |

### How It Works

```mermaid
flowchart TD
    A["BunSqlAdapter (type: &quot;sqlite&quot;)"] --> B["new SQL(url)"]
    BAPI["Bun's native SQL API"] -.-> B
    B --> C["SQLite file on disk"]
```

- When `baseDir` is provided without a `url`, the root adapter connects to `{baseDir}/_default.db`
- The directory is created automatically via `mkdirSync` if it doesn't exist
- All queries go through `sql.unsafe()` for dynamic SQL support
- Transactions use `sql.begin()` with automatic commit/rollback

### Multi-Tenancy Strategy

**Separate files** - Each tenant gets its own `.db` file.

```
.cache/sqlite/
├── _default.db      # Root adapter
├── acme-corp.db     # Tenant: acme-corp
├── contoso.db       # Tenant: contoso
└── .keep
```

- `createTenant`: Ensures `baseDir` exists (file created on first query)
- `deleteTenant`: Truncates the `.db` file
- `listTenants`: Scans `baseDir` for `*.db` files using `Bun.Glob`
- `getTenant`: Returns a new `BunSqlAdapter` with URL `sqlite://{baseDir}/{tenantId}.db`

### Tenant ID Sanitization

Tenant IDs are sanitized to prevent path traversal and SQL injection:

```typescript
// Only allow alphanumeric, underscore, and hyphen
tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
```

### Best For

- Local development
- Single-node deployments
- Plugins that need fast embedded storage (e.g., `plugin-authn` sessions)
- Testing

---

## LibSQL / Turso

Remote LibSQL with replica support using `@libsql/client/http`.

### Configuration

```yaml
adapters:
  - type: libsql
    default: true
    urls:
      - http://libsql:8080        # Primary (writes + reads)
      - http://libsql-r1:8080     # Replica (reads only)
    authToken: your-token
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `"libsql"` | **Required** | Adapter type |
| `urls` | `string[]` | **Required** | Primary URL + optional replicas |
| `authToken` | `string` | - | Authentication token |
| `default` | `boolean` | `false` | Mark as default adapter |

### URL Resolution

URLs can come from three sources (merged with deduplication):

1. **manifest.yaml** `urls` array
2. **`DATABASE_LIBSQL_URL`** environment variable (primary)
3. **`DATABASE_LIBSQL_REPLICAS`** environment variable (comma-separated replicas)

```mermaid
flowchart TD
    A["Config URLs: http://libsql:8080"] --> D["Merged (deduped)"]
    B["Env Primary: http://libsql:8080"] --> D
    C["Env Replicas: http://r1:8080, http://r2:8080"] --> D
    D --> E["http://libsql:8080<br/><i>primary</i>"]
    D --> F["http://r1:8080<br/><i>replica 1</i>"]
    D --> G["http://r2:8080<br/><i>replica 2</i>"]
```

### Read/Write Routing

```mermaid
flowchart LR
    subgraph LibSqlAdapter
        R["SELECT / EXPLAIN"] --> RC["getReadClient()<br/>(round-robin replicas)"]
        W["INSERT / UPDATE / DELETE<br/>CREATE / DROP / ALTER / REPLACE"] --> WC["getWriteClient()<br/>(always primary)"]
    end
```

Write detection uses regex:

```typescript
const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)/i.test(sql);
```

Read queries are load-balanced across replicas with round-robin. If no replicas are configured, all queries go to the primary.

### Multi-Tenancy Strategy

**Namespace routing** - Uses LibSQL's `--enable-namespaces` flag with subdomain routing.

```
Base URL:    http://libsql.home
Tenant URL:  http://{tenant}.libsql.home
```

URL transformation examples:

| Base URL | Tenant ID | Resolved URL |
|----------|-----------|-------------|
| `http://libsql:8080` | `acme-corp` | `http://acme-corp.libsql:8080` |
| `https://db.example.com` | `contoso` | `https://contoso.db.example.com` |
| `file:data.db` | `acme` | `file:data_acme.db` |

Tenant lifecycle uses the LibSQL Admin API:

- `createTenant`: `POST {primaryUrl}/v1/namespaces/{id}/create` (409 = already exists)
- `deleteTenant`: `DELETE {primaryUrl}/v1/namespaces/{id}` (404 = not found)
- `listTenants`: `GET {primaryUrl}/v1/namespaces`

### Replica Architecture

```mermaid
flowchart BT
    LB["LibSqlAdapter<br/>(round-robin index)"] --> Primary["Primary<br/>(writes + reads)"]
    LB --> Replica1["Replica1<br/>(reads)"]
    LB --> Replica2["Replica2<br/>(reads)"]
```

- Replica clients are created for each URL after the first
- Round-robin index wraps around: `(index + 1) % replicas.length`
- If a replica is undefined (shouldn't happen), falls back to primary
- Transactions always execute on primary: `this.client.transaction()`

### Best For

- Production deployments
- Distributed architectures with read scaling
- Multi-tenant SaaS with namespace isolation
- Workers that need database access via HRANA

---

## PostgreSQL (Bun SQL)

PostgreSQL using Bun's native SQL driver.

### Configuration

```yaml
adapters:
  - type: postgres
    url: postgres://user:pass@localhost:5432/db
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `"postgres"` | **Required** | Adapter type |
| `url` | `string` | **Required** | PostgreSQL connection URL |
| `default` | `boolean` | `false` | Mark as default adapter |

### How It Works

- Uses Bun's native `SQL` API with PostgreSQL connection strings
- Queries execute through `sql.unsafe()` for dynamic SQL
- Transactions use `sql.begin()` with automatic commit/rollback

### Multi-Tenancy Strategy

**Schema isolation** - Each tenant gets its own PostgreSQL schema.

```
PostgreSQL Database
├── public          # Default schema (root adapter)
├── acme_corp       # Tenant: acme-corp
├── contoso         # Tenant: contoso
└── pg_catalog      # System (excluded from listings)
```

- `createTenant`: `CREATE SCHEMA IF NOT EXISTS {safeName}`
- `deleteTenant`: `DROP SCHEMA IF EXISTS {safeName} CASCADE`
- `listTenants`: Queries `information_schema.schemata`, excludes system schemas
- `getTenant`: Returns a new `BunSqlAdapter` with the same URL but sets `search_path`

Before every query on a tenant adapter, the schema is set:

```sql
SET search_path TO {tenant_schema}, public
```

### Best For

- Teams already running PostgreSQL
- Applications needing relational features beyond SQLite
- Schema-based multi-tenancy patterns

---

## MySQL (Bun SQL)

MySQL using Bun's native SQL driver.

### Configuration

```yaml
adapters:
  - type: mysql
    url: mysql://user:pass@localhost:3306/db
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `"mysql"` | **Required** | Adapter type |
| `url` | `string` | **Required** | MySQL connection URL |
| `default` | `boolean` | `false` | Mark as default adapter |

### Multi-Tenancy Strategy

**Database isolation** - Each tenant gets its own MySQL database.

```
MySQL Server
├── myapp           # Default database (root adapter)
├── acme_corp       # Tenant: acme-corp
├── contoso         # Tenant: contoso
├── mysql           # System (excluded from listings)
└── information_schema
```

- `createTenant`: `` CREATE DATABASE IF NOT EXISTS `{safeName}` ``
- `deleteTenant`: `` DROP DATABASE IF EXISTS `{safeName}` ``
- `listTenants`: Queries `information_schema.schemata`, excludes system databases
- `getTenant`: Returns a new `BunSqlAdapter` with the tenant as the database name in the URL

URL transformation for tenants:

```
Base:   mysql://user:pass@localhost:3306/myapp
Tenant: mysql://user:pass@localhost:3306/acme_corp
```

### Best For

- Teams already running MySQL
- Applications requiring MySQL-specific features

---

## Multiple Adapters

You can configure multiple adapters simultaneously. Each adapter type can only appear once.

```yaml
adapters:
  - type: libsql
    default: true
    urls:
      - http://libsql:8080
  - type: sqlite
    baseDir: ./.cache/sqlite/
```

Downstream plugins choose which adapter to use:

```yaml
# plugin-keyval uses libsql (default)
database: libsql

# plugin-authn uses sqlite
database: sqlite
```

### Resolution Order

1. If `type` is specified, use that adapter
2. If `type` is omitted, use the default adapter
3. If no explicit `default: true`, the first adapter becomes default

### Validation Rules

- Each adapter type can only appear once (duplicate throws error)
- Only one adapter can be marked `default: true` (multiple throws error)
- At least one adapter is required (zero throws error)

---

## Raw Client Access

Each adapter exposes the underlying client for advanced operations:

```typescript
// SQLite/PostgreSQL/MySQL
const sqlClient = adapter.getRawClient() as SQL;

// LibSQL
const libsqlClient = adapter.getRawClient() as Client;
```

Use this when you need to pass the client to external libraries (e.g., Drizzle ORM).

---

## Next Steps

- [Multi-Tenancy](multi-tenancy.md) - Tenancy patterns in detail
- [HRANA Protocol](hrana.md) - How workers access the database
- [Configuration](../guides/configuration.md) - Configuration reference
- [API Reference](../api-reference.md) - Complete API reference
