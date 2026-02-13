# Plugin Database

Database abstraction layer plugin for Buntime that provides multi-adapter support, multi-tenancy, HRANA protocol compatibility, and a built-in database studio UI.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Adapters](#adapters)
- [Multi-Tenancy](#multi-tenancy)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [HRANA Protocol](#hrana-protocol)
- [Service Registry](#service-registry)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Integration with Other Plugins](#integration-with-other-plugins)
- [Exported Types](#exported-types)
- [File Structure](#file-structure)
- [Examples](#examples)

## Overview

The `@buntime/plugin-database` provides a unified database abstraction that other plugins depend on. It supports multiple database backends simultaneously, each with optional multi-tenancy isolation. The plugin exposes a `DatabaseService` via the service registry that consumers use to get database adapters.

**Key Features:**

- **Multiple Adapters**: SQLite (via Bun SQL), LibSQL/Turso, PostgreSQL, MySQL
- **Multi-Tenancy**: Per-tenant isolation via separate files (SQLite), namespaces (LibSQL), schemas (PostgreSQL), or databases (MySQL)
- **HRANA Protocol**: WebSocket and HTTP pipeline support for LibSQL wire protocol
- **Database Studio**: Built-in UI for browsing tables, schemas, and executing SQL
- **Auto-Detection**: LibSQL URLs auto-detected from `DATABASE_LIBSQL_URL` environment variable
- **Config Schema**: Helm/Rancher UI config generation for Kubernetes deployments

## Architecture

```mermaid
graph TD
    DS["<b>DatabaseService</b><br/><i>(exposed via provides() to plugins)</i><br/><br/>getRootAdapter(type?)<br/>getAdapter(type?, tenantId?)<br/>createTenant(id, type?)<br/>deleteTenant(id, type?)<br/>listTenants(type?)<br/>getDefaultType()<br/>getAvailableTypes()"]
    DS --> SQLite["SQLite<br/>Adapter"]
    DS --> LibSQL["LibSQL<br/>Adapter"]
    DS --> Postgres["Postgres<br/>Adapter"]
```

**API Mode**: Persistent (routes in `plugin.ts`, runs on main thread). Database connections require persistence.

## Adapters

### SQLite (Bun SQL)

Local file-based SQLite via Bun's built-in SQL driver.

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
| `url` | `string` | - | Database file URL |
| `default` | `boolean` | `false` | Mark as default adapter |

**Multi-tenancy**: Creates separate `.db` files per tenant in `baseDir`.

### LibSQL / Turso

Remote LibSQL with replica support.

```yaml
adapters:
  - type: libsql
    default: true
    urls:
      - http://libsql:8080        # Primary (writes + reads)
      - http://libsql-r1:8080     # Replica (reads only)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `"libsql"` | **Required** | Adapter type |
| `urls` | `string[]` | **Required** | Primary URL + optional replicas |
| `authToken` | `string` | - | Authentication token |
| `default` | `boolean` | `false` | Mark as default adapter |

**Multi-tenancy**: Uses subdomain routing with LibSQL's `--enable-namespaces` flag. Tenant URL: `https://{tenant}.libsql.home`.

**Auto-detection**: URLs can also be set via environment variables:

```bash
DATABASE_LIBSQL_URL=http://libsql:8080
DATABASE_LIBSQL_REPLICAS=http://replica1:8080,http://replica2:8080
```

### PostgreSQL

```yaml
adapters:
  - type: postgres
    url: postgres://user:pass@localhost:5432/db
```

**Multi-tenancy**: Creates separate schemas per tenant.

### MySQL

```yaml
adapters:
  - type: mysql
    url: mysql://user:pass@localhost:3306/db
```

**Multi-tenancy**: Creates separate databases per tenant.

## Multi-Tenancy

Enable per-tenant data isolation:

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
| `maxTenants` | `number` | `1000` | Maximum cached tenant adapters |

## Configuration

### manifest.yaml

```yaml
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

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_LIBSQL_URL` | Primary LibSQL URL | - |
| `DATABASE_LIBSQL_REPLICAS` | Comma-separated replica URLs | - |
| `DATABASE_LIBSQL_AUTH_TOKEN` | LibSQL authentication token | - |

## API Endpoints

All routes are mounted at `/{base}/api/*` (default: `/database/api/*`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/adapters` | List available adapter types and default |
| `GET` | `/api/tenants` | List tenants (optional `?type=` query) |
| `POST` | `/api/tenants` | Create tenant (`{ id, type? }`) |
| `DELETE` | `/api/tenants/:id` | Delete tenant (optional `?type=` query) |
| `GET` | `/api/tables` | List tables (`?type=`, `?tenant=`) |
| `GET` | `/api/tables/:name/schema` | Get table schema/columns |
| `GET` | `/api/tables/:name/rows` | Query table data (`?limit=`, `?offset=`) |
| `POST` | `/api/query` | Execute raw SQL (`{ sql, type?, tenant? }`) |
| `GET` | `/api/health` | Health check (all adapters or `?type=`) |
| `POST` | `/api/pipeline` | HRANA pipeline endpoint (for workers) |

## HRANA Protocol

The plugin implements the [HRANA protocol](https://github.com/libsql/hrana-client-ts) for compatibility with LibSQL clients in workers:

- **HTTP Pipeline**: `POST /database/api/pipeline` for batch SQL execution
- **WebSocket**: `ws://host/database/` for persistent connections

Headers for routing:

| Header | Description |
|--------|-------------|
| `x-hrana-adapter` | Target adapter type |
| `x-hrana-namespace` | Target tenant/namespace |

This allows workers to use standard `@libsql/client` to connect to the database through the runtime's plugin.

## Service Registry

The plugin exposes a `DatabaseService` via `provides()`:

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

### DatabaseAdapter Interface

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

## Lifecycle Hooks

| Hook | Description |
|------|-------------|
| `onInit` | Creates `DatabaseServiceImpl`, initializes adapters, sets up HRANA server |
| `onServerStart` | Configures Bun.serve() for HRANA WebSocket upgrades |
| `onRequest` | Intercepts WebSocket upgrade requests for HRANA protocol |
| `onShutdown` | Closes all adapter connections |

## Integration with Other Plugins

### Consumers

| Plugin | Usage |
|--------|-------|
| `plugin-authn` | Session storage, user management |
| `plugin-keyval` | Key-value store backend |
| `plugin-authz` | Policy storage (file/memory modes don't need it) |

### Usage Pattern

```typescript
// In another plugin's onInit:
const database = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
const adapter = database.getRootAdapter("sqlite");
await adapter.execute("SELECT * FROM users");
```

## Exported Types

```typescript
export type AdapterType = "libsql" | "mysql" | "postgres" | "sqlite";

export interface DatabasePluginConfig { ... }
export interface DatabaseService { ... }
export interface DatabaseAdapter { ... }
export interface TransactionAdapter { ... }
export interface Statement { sql: string; args?: unknown[] }
export interface AdapterConfig = BunSqlAdapterConfig | LibSqlAdapterConfig;
export interface BunSqlAdapterConfig { ... }
export interface LibSqlAdapterConfig { ... }

export class DatabaseServiceImpl { ... }
export class BunSqlAdapter { ... }
export class LibSqlAdapter { ... }
```

## File Structure

```
plugins/plugin-database/
├── manifest.yaml          # Configuration and schema
├── plugin.ts              # Main plugin (routes, websocket, provides)
├── index.ts               # Worker entrypoint (serves studio SPA)
├── server/
│   ├── api.ts            # Hono API routes + HRANA setup
│   ├── service.ts        # DatabaseServiceImpl
│   ├── types.ts          # Type definitions
│   ├── adapters/
│   │   ├── bun-sql.ts    # SQLite/PostgreSQL/MySQL adapter
│   │   └── libsql.ts     # LibSQL adapter
│   └── hrana/
│       ├── server.ts     # HRANA protocol server
│       ├── types.ts      # HRANA type definitions
│       └── websocket.ts  # WebSocket handler
├── client/               # Studio SPA (React + TanStack Router)
│   └── routes/-components/cell-variants/
│       ├── mysql.tsx
│       ├── postgres.tsx
│       └── sqlite.tsx
└── dist/                 # Compiled output
```

## Examples

### SQLite Only (Development)

```yaml
name: "@buntime/plugin-database"
enabled: true
adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
    default: true
```

### LibSQL with Replicas (Production)

```yaml
name: "@buntime/plugin-database"
enabled: true
adapters:
  - type: libsql
    default: true
```

```bash
# Environment variables (via ConfigMap)
DATABASE_LIBSQL_URL=http://libsql:8080
DATABASE_LIBSQL_REPLICAS=http://libsql-replica-1:8080,http://libsql-replica-2:8080
DATABASE_LIBSQL_AUTH_TOKEN=your-token
```

### Multiple Adapters

```yaml
name: "@buntime/plugin-database"
enabled: true
adapters:
  - type: libsql
    default: true
    urls:
      - http://libsql:8080
  - type: sqlite
    baseDir: ./.cache/sqlite/
```

Each downstream plugin can then choose which adapter to use:

```yaml
# plugin-keyval uses libsql (default)
database: libsql

# plugin-authn uses sqlite
database: sqlite
```

### Multi-Tenancy

```yaml
name: "@buntime/plugin-database"
enabled: true
adapters:
  - type: libsql
    default: true
tenancy:
  enabled: true
  header: x-tenant-id
  autoCreate: true
```

## License

See [LICENSE](../../LICENSE) at the project root.
