# Configuration

Complete reference for all plugin-database configuration options.

## Configuration Methods

### 1. manifest.yaml

Static plugin configuration:

```yaml
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true
injectBase: true

entrypoint: dist/client/index.html
pluginEntry: dist/plugin.js

menus:
  - icon: lucide:database
    path: /database
    title: Database
    items:
      - icon: lucide:home
        path: /database
        title: Overview
      - icon: lucide:table-2
        path: /database/studio
        title: Studio

adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
    default: true

tenancy:
  enabled: false
  header: x-tenant-id
  defaultTenant: default
  autoCreate: true
  maxTenants: 1000
```

### 2. Environment Variables

Override adapter URLs and credentials:

```bash
# LibSQL
DATABASE_LIBSQL_URL=http://libsql:8080
DATABASE_LIBSQL_REPLICAS=http://replica1:8080,http://replica2:8080
DATABASE_LIBSQL_AUTH_TOKEN=your-token
```

### 3. Helm Values (Config Schema)

The manifest defines a `config` section for Helm/Rancher UI generation:

```yaml
config:
  libsqlUrl:
    type: string
    label: LibSQL Primary URL
    default: "http://libsql:8080"
    env: DATABASE_LIBSQL_URL
  libsqlReplicas:
    type: array
    label: LibSQL Replica URLs
    default: []
    env: DATABASE_LIBSQL_REPLICAS
  libsqlAuthToken:
    type: password
    label: LibSQL Auth Token
    env: DATABASE_LIBSQL_AUTH_TOKEN
```

This generates ConfigMap entries and Rancher UI fields automatically.

---

## Configuration Options

### Plugin Base

#### base

Base path for the plugin routes and UI.

- **Type:** `string`
- **Default:** `"/database"`

```yaml
base: "/database"
```

All API routes are served at `{base}/api/*`. The Studio UI is served at `{base}/`.

#### enabled

Whether the plugin is active.

- **Type:** `boolean`
- **Default:** `true`

```yaml
enabled: true
```

#### injectBase

Whether to inject the base path into the client SPA.

- **Type:** `boolean`
- **Default:** `true`

---

### Adapters

#### adapters

Array of database adapter configurations. Each adapter type can only appear once.

- **Type:** `AdapterConfig[]`
- **Default:** `[]`

```yaml
adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
    default: true
  - type: libsql
    urls:
      - http://libsql:8080
```

#### adapters[].type

Database adapter type.

- **Type:** `"sqlite" | "libsql" | "postgres" | "mysql"`
- **Required:** Yes

#### adapters[].default

Mark this adapter as the default. Only one adapter can be default. If no adapter is marked default, the first one is used.

- **Type:** `boolean`
- **Default:** `false`

---

### SQLite Adapter Options

#### adapters[].baseDir

Base directory for SQLite database files.

- **Type:** `string`
- **Default:** - (required if no `url`)

```yaml
adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
```

The directory is created automatically if it doesn't exist. The root adapter connects to `{baseDir}/_default.db`.

#### adapters[].url

Explicit database file URL.

- **Type:** `string`
- **Default:** -

```yaml
adapters:
  - type: sqlite
    url: sqlite://path/to/database.db
```

**Note:** Provide either `baseDir` or `url`, not both. `baseDir` is required for multi-tenancy (separate files per tenant).

---

### LibSQL Adapter Options

#### adapters[].urls

Array of LibSQL server URLs. The first URL is the primary (writes + reads), subsequent URLs are replicas (reads only, round-robin).

- **Type:** `string[]`
- **Required:** Yes (at least one URL)

```yaml
adapters:
  - type: libsql
    urls:
      - http://libsql:8080          # Primary
      - http://libsql-r1:8080       # Replica 1
      - http://libsql-r2:8080       # Replica 2
```

URLs are merged with environment variables (deduplication via Set):

```
Final URLs = [...new Set([...config.urls, ...env.urls])]
```

#### adapters[].authToken

Authentication token for LibSQL servers.

- **Type:** `string`
- **Default:** -
- **Env:** `DATABASE_LIBSQL_AUTH_TOKEN`

```yaml
adapters:
  - type: libsql
    authToken: your-secret-token
```

---

### PostgreSQL Adapter Options

#### adapters[].url

PostgreSQL connection URL.

- **Type:** `string`
- **Required:** Yes

```yaml
adapters:
  - type: postgres
    url: postgres://user:pass@localhost:5432/mydb
```

---

### MySQL Adapter Options

#### adapters[].url

MySQL connection URL.

- **Type:** `string`
- **Required:** Yes

```yaml
adapters:
  - type: mysql
    url: mysql://user:pass@localhost:3306/mydb
```

---

### Tenancy

#### tenancy.enabled

Enable multi-tenancy.

- **Type:** `boolean`
- **Default:** `false`

```yaml
tenancy:
  enabled: true
```

#### tenancy.header

HTTP header used to identify the tenant.

- **Type:** `string`
- **Default:** `"x-tenant-id"`

```yaml
tenancy:
  header: x-tenant-id
```

#### tenancy.defaultTenant

Default tenant ID when the header is missing from the request.

- **Type:** `string`
- **Default:** `"default"`

```yaml
tenancy:
  defaultTenant: default
```

#### tenancy.autoCreate

Automatically create tenant on first access. When enabled, the service calls `createTenant()` before `getTenant()`, ignoring "already exists" errors.

- **Type:** `boolean`
- **Default:** `true`

```yaml
tenancy:
  autoCreate: true
```

#### tenancy.maxTenants

Maximum number of tenant adapters cached per adapter type. Uses LRU eviction - when the cache is full, the least recently used adapter is closed and removed.

- **Type:** `number`
- **Default:** `1000`

```yaml
tenancy:
  maxTenants: 1000
```

---

### Menu Configuration

#### menus

Navigation menu entries for the Buntime UI shell.

```yaml
menus:
  - icon: lucide:database
    path: /database
    title: Database
    items:
      - icon: lucide:home
        path: /database
        title: Overview
      - icon: lucide:table-2
        path: /database/studio
        title: Studio
```

---

## Environment Variables

| Variable | Type | Description | Default |
|----------|------|-------------|---------|
| `DATABASE_LIBSQL_URL` | `string` | Primary LibSQL URL | - |
| `DATABASE_LIBSQL_REPLICAS` | `string` | Comma-separated replica URLs | - |
| `DATABASE_LIBSQL_AUTH_TOKEN` | `string` | LibSQL authentication token | - |

### URL Auto-Detection

When a `libsql` adapter is configured, the plugin auto-detects URLs from environment variables:

```
DATABASE_LIBSQL_URL=http://libsql:8080
DATABASE_LIBSQL_REPLICAS=http://replica1:8080,http://replica2:8080
```

These are merged with any URLs in `manifest.yaml`:

```
manifest.yaml urls:  [http://libsql:8080]
env primary:         http://libsql:8080
env replicas:        http://replica1:8080, http://replica2:8080

merged (deduped):    [http://libsql:8080, http://replica1:8080, http://replica2:8080]
```

---

## Complete Examples

### Local Development (SQLite Only)

```yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true

adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
    default: true
```

No environment variables needed. SQLite files stored locally.

### LibSQL with Replicas (Production)

```yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true

adapters:
  - type: libsql
    default: true
```

```bash
# Environment variables (via ConfigMap/Secret)
DATABASE_LIBSQL_URL=http://libsql:8080
DATABASE_LIBSQL_REPLICAS=http://libsql-replica-1:8080,http://libsql-replica-2:8080
DATABASE_LIBSQL_AUTH_TOKEN=your-secure-token
```

### Multiple Adapters

```yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true

adapters:
  - type: libsql
    default: true
    urls:
      - http://libsql:8080
  - type: sqlite
    baseDir: ./.cache/sqlite/
```

Downstream plugins choose which adapter:

```yaml
# plugin-keyval/manifest.yaml
database: libsql    # Uses default

# plugin-authn/manifest.yaml
database: sqlite    # Uses sqlite for local session storage
```

### Multi-Tenant SaaS

```yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true

adapters:
  - type: libsql
    default: true

tenancy:
  enabled: true
  header: x-tenant-id
  defaultTenant: default
  autoCreate: true
  maxTenants: 5000
```

```bash
DATABASE_LIBSQL_URL=http://libsql:8080
DATABASE_LIBSQL_AUTH_TOKEN=your-token
```

LibSQL server must be started with `--enable-namespaces`.

### PostgreSQL with Schema Tenancy

```yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true

adapters:
  - type: postgres
    url: postgres://user:pass@pg:5432/myapp
    default: true

tenancy:
  enabled: true
  header: x-org-id
  autoCreate: true
  maxTenants: 500
```

### Mixed: LibSQL + SQLite (with Tenancy)

```yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true

adapters:
  - type: libsql
    default: true
    urls:
      - http://libsql:8080
  - type: sqlite
    baseDir: ./.cache/sqlite/

tenancy:
  enabled: true
  header: x-tenant-id
  autoCreate: true
```

Both adapters support tenancy independently:
- LibSQL creates namespaces
- SQLite creates separate files

---

## Helm Values

### values.yaml (auto-generated from config schema)

```yaml
plugins:
  database:
    libsqlUrl: "http://libsql:8080"
    libsqlReplicas: []
    libsqlAuthToken: ""
```

### Override on Deploy

```bash
helm upgrade buntime ./charts/buntime \
  --set plugins.database.libsqlUrl="http://libsql:8080" \
  --set plugins.database.libsqlAuthToken="your-token"
```

### Secret for Auth Token

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: database-secrets
type: Opaque
data:
  DATABASE_LIBSQL_AUTH_TOKEN: eW91ci10b2tlbg==  # base64
```

---

## Validation

### Health Check

```bash
# Check all adapters
curl http://localhost:8000/database/api/health

# Expected response
# { "status": "healthy", "adapters": { "libsql": "healthy", "sqlite": "healthy" } }
```

### Adapter Listing

```bash
# List configured adapters
curl http://localhost:8000/database/api/adapters

# Expected response
# { "adapters": ["libsql", "sqlite"], "default": "libsql" }
```

### Query Test

```bash
# Test SQL execution
curl -X POST http://localhost:8000/database/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT 1 as ping"}'

# Expected response
# { "rows": [{ "ping": 1 }], "rowCount": 1, "duration": 0 }
```

### Tenant Operations

```bash
# Create tenant
curl -X POST http://localhost:8000/database/api/tenants \
  -H "Content-Type: application/json" \
  -d '{"id": "test-tenant"}'

# List tenants
curl http://localhost:8000/database/api/tenants

# Delete tenant
curl -X DELETE http://localhost:8000/database/api/tenants/test-tenant
```

---

## Next Steps

- [Overview](../concepts/overview.md) - Architecture and components
- [Adapters](../concepts/adapters.md) - Adapter deep dive
- [Multi-Tenancy](../concepts/multi-tenancy.md) - Multi-tenancy patterns
- [HRANA Protocol](../concepts/hrana.md) - HRANA protocol details
- [API Reference](../api-reference.md) - Complete API reference
