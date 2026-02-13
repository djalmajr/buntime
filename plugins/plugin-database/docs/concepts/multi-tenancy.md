# Multi-Tenancy

How tenant isolation works in plugin-database. Each adapter implements a different strategy for keeping tenant data separate.

## Overview

Multi-tenancy provides per-tenant data isolation so a single database plugin instance can serve multiple tenants. Each tenant gets its own isolated storage space, and the strategy varies by adapter type:

| Adapter | Isolation Strategy | Mechanism |
|---------|-------------------|-----------|
| SQLite | Separate files | `{baseDir}/{tenantId}.db` |
| LibSQL | Namespaces | Subdomain routing `{tenant}.host` |
| PostgreSQL | Schemas | `CREATE SCHEMA` + `SET search_path` |
| MySQL | Databases | `CREATE DATABASE` per tenant |

## Configuration

Enable multi-tenancy in `manifest.yaml`:

```yaml
tenancy:
  enabled: true
  header: x-tenant-id
  defaultTenant: default
  autoCreate: true
  maxTenants: 1000
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable multi-tenancy |
| `header` | `string` | `"x-tenant-id"` | HTTP header for tenant identification |
| `defaultTenant` | `string` | `"default"` | Default tenant when header is missing |
| `autoCreate` | `boolean` | `true` | Auto-create tenant on first access |
| `maxTenants` | `number` | `1000` | Maximum cached tenant adapters (LRU) |

## How It Works

### Request Flow

```mermaid
flowchart TD
    A["Request with x-tenant-id: acme-corp"] --> B["DatabaseService.getAdapter(type, &quot;acme-corp&quot;)"]
    B --> C{"Check LRU cache<br/>for &quot;acme-corp&quot;"}
    C -- HIT --> D["Return cached adapter"]
    C -- MISS --> E{"autoCreate<br/>enabled?"}
    E -- YES --> F["adapter.createTenant(&quot;acme-corp&quot;)<br/>(ignore if already exists)"]
    F --> G["adapter.getTenant(&quot;acme-corp&quot;)<br/>Returns new adapter scoped to tenant"]
    E -- NO --> G
    G --> H["Cache in LRU → return tenant adapter"]
```

### Tenant Adapter Caching

Tenant adapters are cached in an LRU cache (`quick-lru`) per adapter type:

```mermaid
graph LR
    TC["tenantCache<br/>Map&lt;AdapterType, QuickLRU&gt;"]
    TC --> LS["libsql"]
    TC --> SQ["sqlite"]
    subgraph LRU1["QuickLRU (libsql)"]
        L1["acme-corp → LibSqlAdapter"]
        L2["contoso → LibSqlAdapter"]
        L3["...up to maxTenants entries"]
    end
    subgraph LRU2["QuickLRU (sqlite)"]
        S1["acme-corp → BunSqlAdapter"]
        S2["..."]
    end
    LS --> LRU1
    SQ --> LRU2
```

When the cache reaches `maxTenants`, the least recently used adapter is evicted and its `close()` method is called to release resources.

### Auto-Creation

When `autoCreate: true`, the service automatically creates a tenant on first access:

```typescript
// Inside getAdapter():
if (this.autoCreate) {
  try {
    await adapter.createTenant(tenantId);
  } catch (error) {
    // Ignore if already exists
  }
}
```

This means new tenants are provisioned transparently when a request arrives with a new tenant ID.

---

## SQLite Multi-Tenancy

**Strategy:** Separate `.db` files per tenant.

```
.cache/sqlite/
├── _default.db        # Root adapter (no tenant)
├── acme-corp.db       # Tenant: acme-corp
├── contoso.db         # Tenant: contoso
└── startup-inc.db     # Tenant: startup-inc
```

### Create Tenant

No explicit creation needed - SQLite files are created on first access. The `createTenant` method ensures the `baseDir` exists:

```typescript
async createTenant(tenantId: string): Promise<void> {
  const baseDir = this.config.baseDir ?? "/tmp/buntime";
  await Bun.write(`${baseDir}/.keep`, "");
}
```

### Get Tenant Adapter

Returns a new `BunSqlAdapter` with URL pointing to the tenant file:

```typescript
// URL: sqlite://{baseDir}/{tenantId}.db
const tenantAdapter = new BunSqlAdapter(config, tenantId);
```

### Delete Tenant

Truncates the `.db` file (cannot delete while potentially open):

```typescript
await Bun.write(filePath, ""); // Clear file contents
```

### List Tenants

Scans `baseDir` for `*.db` files:

```typescript
const glob = new Bun.Glob("*.db");
for await (const file of glob.scan(baseDir)) {
  files.push(file.replace(/\.db$/, ""));
}
```

### Characteristics

- Complete file-level isolation
- No shared state between tenants
- Easy backup per tenant (copy the file)
- Works well for development and single-node deployments
- File count grows linearly with tenants

---

## LibSQL Multi-Tenancy

**Strategy:** Namespace routing via subdomains.

Requires LibSQL server started with `--enable-namespaces` flag.

### URL Transformation

```
Base:     http://libsql:8080
Tenant:   http://{tenant}.libsql:8080
```

```mermaid
flowchart TD
    subgraph LibSQL["LibSQL Server (--enable-namespaces)"]
        A["http://libsql:8080<br/>default namespace"]
        B["http://acme-corp.libsql:8080<br/>acme-corp namespace"]
        C["http://contoso.libsql:8080<br/>contoso namespace"]
    end
```

### Create Tenant

Uses the LibSQL Admin API:

```http
POST http://libsql:8080/v1/namespaces/acme-corp/create
Authorization: Bearer {authToken}
```

- `200 OK` = created
- `409 Conflict` = already exists (ignored)

### Delete Tenant

```http
DELETE http://libsql:8080/v1/namespaces/acme-corp
Authorization: Bearer {authToken}
```

- `200 OK` = deleted
- `404 Not Found` = not found (ignored)

### List Tenants

```http
GET http://libsql:8080/v1/namespaces
Authorization: Bearer {authToken}
```

Returns `{ "namespaces": ["default", "acme-corp", "contoso"] }`.

### Get Tenant Adapter

Returns a new `LibSqlAdapter` with URLs transformed to use the tenant subdomain:

```typescript
// Primary: http://acme-corp.libsql:8080
// Replica1: http://acme-corp.libsql-r1:8080
const tenantAdapter = new LibSqlAdapter(config, tenantId);
```

All replicas are also transformed to include the tenant subdomain.

### Characteristics

- Network-level isolation via namespaces
- Scales horizontally with LibSQL server
- Replicas work per-namespace
- Admin API for tenant lifecycle
- Best for production multi-tenant SaaS

---

## PostgreSQL Multi-Tenancy

**Strategy:** Schema isolation within a single database.

```
PostgreSQL Database
├── public             # Root adapter uses public schema
├── acme_corp          # Tenant schema
│   ├── users
│   ├── orders
│   └── ...
├── contoso            # Tenant schema
│   ├── users
│   ├── orders
│   └── ...
└── pg_catalog         # System (excluded)
```

### Create Tenant

```sql
CREATE SCHEMA IF NOT EXISTS acme_corp
```

### Delete Tenant

```sql
DROP SCHEMA IF EXISTS acme_corp CASCADE
```

**Warning:** `CASCADE` drops all objects (tables, views, functions) in the schema.

### List Tenants

```sql
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'public', 'pg_toast')
```

### Query Routing

Before every query on a tenant adapter, the schema search path is set:

```sql
SET search_path TO acme_corp, public
```

This means unqualified table references resolve to the tenant schema first, then fall back to `public` for shared tables.

### Characteristics

- Efficient resource sharing (single database, single connection pool)
- Schema-level isolation
- Shared `public` schema for common tables
- All tenants accessible via same connection URL
- Good for moderate tenant counts

---

## MySQL Multi-Tenancy

**Strategy:** Separate databases per tenant.

```
MySQL Server
├── myapp              # Default database (root adapter)
├── acme_corp          # Tenant database
│   ├── users
│   └── orders
├── contoso            # Tenant database
│   ├── users
│   └── orders
├── mysql              # System (excluded)
└── information_schema # System (excluded)
```

### Create Tenant

```sql
CREATE DATABASE IF NOT EXISTS `acme_corp`
```

### Delete Tenant

```sql
DROP DATABASE IF EXISTS `acme_corp`
```

### List Tenants

```sql
SELECT schema_name FROM information_schema.schemata
WHERE schema_name NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
```

### URL Routing

The tenant adapter modifies the database name in the connection URL:

```
Base:   mysql://user:pass@localhost:3306/myapp
Tenant: mysql://user:pass@localhost:3306/acme_corp
```

### Characteristics

- Database-level isolation
- Each tenant is a separate MySQL database
- New connection per tenant database
- Good for strong isolation requirements

---

## Tenant ID Sanitization

All adapter types sanitize tenant IDs before using them in schema names, database names, or file paths:

```typescript
private sanitizeTenantId(tenantId: string): string {
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
}
```

| Input | Sanitized |
|-------|-----------|
| `acme-corp` | `acme-corp` |
| `my.tenant` | `my_tenant` |
| `../evil` | `___evil` |
| `drop; --` | `drop__--` |

This prevents SQL injection in `CREATE SCHEMA`, `DROP DATABASE`, and similar statements that use identifier names directly.

---

## Programmatic Tenant Management

### From Another Plugin

```typescript
const database = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");

// Create tenant
await database.createTenant("acme-corp", "libsql");

// Get tenant adapter
const adapter = await database.getAdapter("libsql", "acme-corp");
await adapter.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY)");

// Delete tenant
await database.deleteTenant("acme-corp", "libsql");

// List tenants
const tenants = await database.listTenants("libsql");
```

### Via API

```bash
# Create tenant
curl -X POST http://localhost:8000/database/api/tenants \
  -H "Content-Type: application/json" \
  -d '{"id": "acme-corp", "type": "libsql"}'

# List tenants
curl http://localhost:8000/database/api/tenants?type=libsql

# Delete tenant
curl -X DELETE http://localhost:8000/database/api/tenants/acme-corp?type=libsql
```

---

## Comparison

| Feature | SQLite | LibSQL | PostgreSQL | MySQL |
|---------|--------|--------|------------|-------|
| Isolation | File | Namespace | Schema | Database |
| Shared resources | None | Server | Connection | Server |
| Create speed | Instant | Network call | DDL | DDL |
| Backup per tenant | Copy file | Admin API | `pg_dump -n` | `mysqldump` |
| Max tenants | Filesystem limit | Server limit | ~10K schemas | ~10K databases |
| Connection reuse | No | Yes (per namespace) | Yes (search_path) | No (new URL) |
| Read replicas | No | Yes | External | External |

---

## Next Steps

- [Adapters](adapters.md) - Adapter implementation details
- [HRANA Protocol](hrana.md) - How workers access tenant databases
- [Configuration](../guides/configuration.md) - Configuration reference
- [API Reference](../api-reference.md) - Tenant API endpoints
