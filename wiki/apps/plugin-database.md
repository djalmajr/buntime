---
title: "@buntime/plugin-database"
audience: dev
sources:
  - plugins/plugin-database/README.md
  - plugins/plugin-database/manifest.yaml
  - plugins/plugin-database/docs/api-reference.md
  - plugins/plugin-database/docs/concepts/overview.md
  - plugins/plugin-database/docs/concepts/adapters.md
  - plugins/plugin-database/docs/concepts/multi-tenancy.md
  - plugins/plugin-database/docs/concepts/hrana.md
  - plugins/plugin-database/docs/guides/configuration.md
  - plugins/plugin-database/docs/deployment/troubleshooting.adoc
updated: 2026-05-02
tags: [plugin, database, libsql, sqlite, multi-tenancy, hrana]
status: stable
---

# @buntime/plugin-database

> Buntime's database abstraction layer: exposes a single `DatabaseService`
> to other plugins and workers, with support for multiple adapters (SQLite, LibSQL,
> PostgreSQL, MySQL), per-tenant isolation, and the HRANA protocol for access from the
> worker pool.

## Overview

The plugin is the single point of data access inside Buntime. It:

- Initializes a set of adapters declared in `manifest.yaml`, each covering
  a different engine.
- Exposes a `DatabaseService` via `provides()` (consumed by
  [plugin-authn](./plugin-authn.md), [plugin-keyval](./plugin-keyval.md), and
  [plugin-authz](./plugin-authz.md) — see [Plugin System](./plugin-system.md) for the
  `provides()`/`getPlugin()` contract).
- Implements a HRANA server (HTTP + WebSocket) so that workers can use
  `@libsql/client` pointing at the runtime, without opening direct TCP connections to the database.
- Serves a Studio SPA (`/database`) for inspecting tables, schemas, and running SQL.

**API mode**: persistent. Routes live in `plugin.ts` and run on the main thread —
database connections must survive across requests and do not fit the serverless model.
See [Plugin System](./plugin-system.md) for the persistent/serverless distinction.

```mermaid
graph TD
    DS["DatabaseService<br/>(provides())"]
    DS --> SQLite["BunSqlAdapter<br/>(sqlite)"]
    DS --> Postgres["BunSqlAdapter<br/>(postgres)"]
    DS --> MySQL["BunSqlAdapter<br/>(mysql)"]
    DS --> LibSQL["LibSqlAdapter<br/>(libsql)"]
    DS -.-> HRANA["HRANA Server<br/>(workers)"]
    DS -.-> Studio["Studio SPA<br/>(/database)"]
    SQLite --> SQLiteT[".db per tenant"]
    LibSQL --> LibSQLT["namespace per tenant<br/>(subdomain)"]
    Postgres --> PostgresT["schema per tenant"]
    MySQL --> MySQLT["database per tenant"]
```

## Configuration

### manifest.yaml — main keys

| Key             | Type               | Default          | Description                                                              |
|-----------------|--------------------|------------------|--------------------------------------------------------------------------|
| `name`          | `string`           | —                | `"@buntime/plugin-database"`                                             |
| `base`          | `string`           | `/database`      | Route prefix and Studio base path                                        |
| `enabled`       | `boolean`          | `true`           | Enables or disables the plugin                                           |
| `injectBase`    | `boolean`          | `true`           | Injects the `base` into the client SPA                                   |
| `entrypoint`    | `string`           | —                | HTML served by the SPA (`dist/client/index.html`)                        |
| `pluginEntry`   | `string`           | —                | Compiled plugin entrypoint (`dist/plugin.js`)                            |
| `adapters`      | `AdapterConfig[]`  | `[]`             | List of adapters; each `type` may appear only once                       |
| `tenancy`       | `TenancyConfig`    | see table        | Multi-tenancy configuration                                              |
| `menus`         | `MenuItem[]`       | —                | Navigation items injected into the Buntime shell                         |
| `config`        | `ConfigSchema`     | —                | Schema used to generate the Helm `values.yaml` and Rancher `questions.yml` |

### Adapters — options per type

| Type       | Options                                              | Default                         | Notes                                                    |
|------------|------------------------------------------------------|---------------------------------|----------------------------------------------------------|
| `sqlite`   | `baseDir` or `url`, `default`                        | —                               | `baseDir` required for multi-tenancy                     |
| `libsql`   | `urls[]` (primary + replicas), `authToken`, `default` | Auto-detected via env vars     | Requires a LibSQL server started with `--enable-namespaces` |
| `postgres` | `url`, `default`                                     | —                               | URL format: `postgres://user:pass@host:port/db`          |
| `mysql`    | `url`, `default`                                     | —                               | URL format: `mysql://user:pass@host:port/db`             |

Validation rules applied in `onInit`:

- at least one adapter is required;
- each `type` may appear only once;
- at most one adapter with `default: true` (if none, the first one becomes the default).

### Tenancy

| Key              | Type      | Default        | Description                                                        |
|------------------|-----------|----------------|--------------------------------------------------------------------|
| `enabled`        | `boolean` | `false`        | Enables multi-tenancy                                              |
| `header`         | `string`  | `x-tenant-id`  | HTTP header that carries the tenant ID                             |
| `defaultTenant`  | `string`  | `default`      | Used when the header is absent                                     |
| `autoCreate`     | `boolean` | `true`         | Creates the tenant on first access (ignores "already exists")      |
| `maxTenants`     | `number`  | `1000`         | LRU cache size for per-tenant adapters; eviction calls `close()`   |

### Environment variables

| Variable                       | Description                                        | Default |
|--------------------------------|----------------------------------------------------|---------|
| `DATABASE_LIBSQL_URL`          | Primary LibSQL URL                                 | —       |
| `DATABASE_LIBSQL_REPLICAS`     | Comma-separated replica URLs                       | —       |
| `DATABASE_LIBSQL_AUTH_TOKEN`   | LibSQL authentication token                        | —       |

URLs from the manifest and the environment are merged via `Set` (deduplication): the first
URL in the resulting list is the primary; the rest enter the replica pool.

## Architecture

### Components

| Component             | File                          | Responsibility                                                                   |
|-----------------------|-------------------------------|----------------------------------------------------------------------------------|
| `DatabaseServiceImpl` | `server/service.ts`           | Orchestrates adapters, validates configuration, maintains per-tenant LRU caches  |
| `BunSqlAdapter`       | `server/adapters/bun-sql.ts`  | Covers `sqlite`, `postgres`, `mysql` via `Bun.SQL`                               |
| `LibSqlAdapter`       | `server/adapters/libsql.ts`   | Covers `libsql` via `@libsql/client/http`; round-robins across replicas          |
| `HranaServer`         | `server/hrana/server.ts`      | Implements HRANA 3 (pipeline + baton sessions + prepared statements)             |
| WebSocket handler     | `server/hrana/websocket.ts`   | Persistent HRANA connection (`/database/api/ws`)                                 |
| REST API              | `server/api.ts`               | Hono routes used by the Studio and external consumers                            |
| Studio SPA            | `client/`                     | React + TanStack Router UI served at `/database`                                 |

### Query flow (LibSQL)

Reads go to a replica via round-robin; writes always go to the primary. Detection
is done via a regex on the beginning of the SQL statement:

```text
/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)/i
```

If no replica is configured, all queries go to the primary.
Transactions always execute on the primary.

### Lifecycle hooks

| Hook            | Action                                                                                          |
|-----------------|-------------------------------------------------------------------------------------------------|
| `onInit`        | Substitutes env vars, merges LibSQL URLs, instantiates `DatabaseServiceImpl` and the HRANA server |
| `onServerStart` | Receives the `Bun.serve()` reference for the WebSocket upgrade handler                          |
| `onRequest`     | Intercepts WebSocket upgrades destined for `/database/api/ws` and forwards them to HRANA        |
| `onShutdown`    | Closes cached adapters (tenants and roots), releases connections                                |

For the detailed hook contract see [Plugin System](./plugin-system.md).

## Multi-tenancy

Each adapter implements a different isolation strategy; the `DatabaseAdapter` interface
exposed to consumers is the same.

| Adapter      | Strategy               | Creation                                           | Listing                                                    |
|--------------|------------------------|----------------------------------------------------|------------------------------------------------------------|
| `sqlite`     | Per-tenant `.db` file  | Lazy (created on first write)                      | `Bun.Glob("*.db")` in `baseDir`                            |
| `libsql`     | Namespace via subdomain | `POST {primary}/v1/namespaces/{id}/create` (Admin API) | `GET {primary}/v1/namespaces`                          |
| `postgres`   | Schema                 | `CREATE SCHEMA IF NOT EXISTS {id}`                 | `information_schema.schemata` (system schemas excluded)    |
| `mysql`      | Database               | `CREATE DATABASE IF NOT EXISTS {id}`               | `information_schema.schemata` (system schemas excluded)    |

### Tenant resolution

```mermaid
flowchart TD
    A["Request with x-tenant-id: acme-corp"] --> B["DatabaseService.getAdapter(type, 'acme-corp')"]
    B --> C{LRU cache hit?}
    C -- HIT --> D[Cached adapter]
    C -- MISS --> E{autoCreate?}
    E -- YES --> F["adapter.createTenant(id)<br/>(ignores 'already exists')"]
    F --> G["adapter.getTenant(id)"]
    E -- NO --> G
    G --> H[Store in LRU + return]
```

### Tenant ID sanitization

Tenant IDs are sanitized before being used as schema names, database names, or file paths:

```typescript
tenantId.replace(/[^a-zA-Z0-9_-]/g, "_")
```

This blocks path traversal (`../evil` → `___evil`) and DDL injection
(`drop; --` → `drop__--`). LibSQL does not use this regex because the tenant is
passed as a subdomain — the Admin API rejects invalid characters directly.

### URL transformation (LibSQL)

| Base URL                 | Tenant      | Resolved                            |
|--------------------------|-------------|-------------------------------------|
| `http://libsql:8080`     | `acme-corp` | `http://acme-corp.libsql:8080`      |
| `https://db.example.com` | `contoso`   | `https://contoso.db.example.com`    |
| `file:data.db`           | `acme`      | `file:data_acme.db`                 |

Replicas also receive the tenant subdomain.

## Service Registry

`DatabaseService` is exposed via `provides()`:

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
  getRawClient(): unknown; // Bun SQL or @libsql/client
}

type AdapterType = "libsql" | "mysql" | "postgres" | "sqlite";
```

Consuming from another plugin:

```typescript
const database = ctx.getPlugin<DatabaseService>("@buntime/plugin-database");
const adapter = database.getRootAdapter("sqlite");
await adapter.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
```

`getRawClient()` returns the underlying client (`Bun.SQL` or `@libsql/client`) for
cases where you need to pass the connection directly to an ORM like Drizzle.

## REST API

All routes live under `{base}/api/*` (default `/database/api/*`). **There is no
authentication by default** — in production, protect with [plugin-authn](./plugin-authn.md)
or network-level controls.

| Method  | Route                             | Function                                                       |
|---------|-----------------------------------|----------------------------------------------------------------|
| GET     | `/api/adapters`                   | Lists available types and the default                          |
| GET     | `/api/health`                     | Health check (`?type=` for a specific adapter)                 |
| GET     | `/api/tenants`                    | Lists tenants (`?type=`)                                       |
| POST    | `/api/tenants`                    | Creates a tenant (`{ id, type? }`)                             |
| DELETE  | `/api/tenants/:id`                | Deletes a tenant (`?type=`)                                    |
| GET     | `/api/tables`                     | Lists tables/views (`?type=`, `?tenant=`)                      |
| GET     | `/api/tables/:name/schema`        | Columns (name, type, nullable, pk)                             |
| GET     | `/api/tables/:name/rows`          | Rows with pagination (`?limit=` capped at 1000, `?offset=`)    |
| POST    | `/api/query`                      | Executes raw SQL (`{ sql, type?, tenant? }`)                   |
| POST    | `/api/pipeline`                   | HRANA pipeline (workers via `@libsql/client`)                  |
| WS      | `/api/ws`                         | HRANA WebSocket (persistent session)                           |

### curl examples

```bash
# General health
curl http://localhost:8000/database/api/health

# List tables for a tenant
curl "http://localhost:8000/database/api/tables?type=libsql&tenant=acme-corp"

# Execute parameterized SQL for a tenant
curl -X POST http://localhost:8000/database/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT COUNT(*) AS n FROM users","type":"libsql","tenant":"acme-corp"}'

# Create a tenant
curl -X POST http://localhost:8000/database/api/tenants \
  -H "Content-Type: application/json" \
  -d '{"id":"acme-corp","type":"libsql"}'

# HRANA pipeline with explicit adapter/tenant
curl -X POST http://localhost:8000/database/api/pipeline \
  -H "Content-Type: application/json" \
  -H "x-database-adapter: sqlite" \
  -H "x-database-namespace: acme-corp" \
  -d '{"baton":null,"requests":[{"type":"execute","stmt":{"sql":"SELECT 1 AS ping","want_rows":true}}]}'
```

### Common errors

| Status | Body                                                       | Cause                                          |
|--------|------------------------------------------------------------|------------------------------------------------|
| 400    | `{"error":"Missing or invalid tenant id"}`                 | Invalid request body                           |
| 500    | `{"error":"Service not initialized"}`                      | `onInit` has not completed yet                 |
| 500    | `{"error":"Adapter type \"X\" not configured. Available: ..."}` | Requested `type` is not in the manifest   |

## HRANA Protocol

The server implements HRANA 3 so that **any adapter** (not just LibSQL) is
accessible via `@libsql/client` running inside a worker. This prevents workers
from opening direct TCP connections to the database — all I/O passes through the runtime.

### Transports

| Transport  | Endpoint                      | Usage                                              |
|------------|-------------------------------|----------------------------------------------------|
| HTTP       | `POST /database/api/pipeline` | Stateless, batched requests                        |
| WebSocket  | `WS /database/api/ws`         | Persistent connection, messages with `request_id`  |

### Routing headers

| Header                  | Purpose                                                  |
|-------------------------|----------------------------------------------------------|
| `x-database-adapter`    | Target adapter (`sqlite`, `libsql`, `postgres`, `mysql`) |
| `x-database-namespace`  | Target tenant                                            |

Without these headers, the default adapter and root adapter (no tenant) are used.

### Stream request types

`execute`, `batch`, `sequence`, `describe`, `store_sql`, `close_sql`, `close`,
`get_autocommit`. `batch` accepts per-step conditions (`{ ok: N }`, `{ error: N }`,
`{ not }`, `{ and }`, `{ or }`, `{ is_autocommit: true }`, `null`).

### Sessions and baton

- `baton: null` in the initial request — the server may open a session (UUID) if
  it detects `BEGIN`/`TRANSACTION` or if `store_sql` is present.
- The client resends the baton in subsequent requests to continue the session.
- Sessions expire after **30 seconds** of inactivity (cleanup runs every 60s); the
  returned error is `INVALID_BATON`.
- `store_sql` requires an active session (otherwise returns `NO_SESSION`).

### Value encoding

| HRANA type | JSON                                          | JavaScript                          |
|------------|-----------------------------------------------|-------------------------------------|
| `null`     | `{"type":"null"}`                             | `null`                              |
| `text`     | `{"type":"text","value":"..."}`               | `string`                            |
| `integer`  | `{"type":"integer","value":"42"}`             | `number` (safe) or `BigInt`         |
| `float`    | `{"type":"float","value":3.14}`               | `number`                            |
| `blob`     | `{"type":"blob","base64":"..."}`              | `Uint8Array`                        |

Integers are serialized as strings to avoid precision loss.
`Number.isSafeInteger` determines whether decoding produces a `number` or `BigInt`.

### Error codes

HRANA error codes mapped from the underlying database error:

`SQLITE_ERROR`, `SQLITE_CONSTRAINT`, `SQLITE_CONSTRAINT_UNIQUE`,
`SQLITE_CONSTRAINT_PRIMARYKEY`, `SQLITE_CONSTRAINT_FOREIGNKEY`,
`SQLITE_CONSTRAINT_NOTNULL`, `SQLITE_CONSTRAINT_CHECK`, `SQLITE_BUSY`,
`SQLITE_READONLY`, `SQLITE_AUTH`, `INVALID_BATON`, `UNKNOWN_REQUEST`,
`NO_SESSION`, `MISSING_SQL`, `PARSE_ERROR`, `INTERNAL_ERROR`.

Resolution order: string code already present → numeric SQLite code mapping →
inference from the error message.

### Usage example (worker)

```typescript
import { createClient } from "@libsql/client/http";

const db = createClient({
  url: "http://localhost:8000/database/api/pipeline",
});

await db.execute({
  sql: "SELECT * FROM users WHERE email = ?",
  args: ["alice@example.com"],
});
```

To target a non-default adapter/tenant, the standard client does not support
extra headers — call the pipeline endpoint directly with `x-database-adapter` and
`x-database-namespace`.

## Configuration examples

### Local development (SQLite)

```yaml
adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
    default: true
```

No env vars required; the `_default.db` file is created inside `baseDir`.

### Production LibSQL with replicas

```yaml
adapters:
  - type: libsql
    default: true
```

```bash
DATABASE_LIBSQL_URL=http://libsql:8080
DATABASE_LIBSQL_REPLICAS=http://libsql-r1:8080,http://libsql-r2:8080
DATABASE_LIBSQL_AUTH_TOKEN=...
```

### Multi-tenant SaaS

```yaml
adapters:
  - type: libsql
    default: true
tenancy:
  enabled: true
  header: x-tenant-id
  autoCreate: true
  maxTenants: 5000
```

The LibSQL server must have been started with `--enable-namespaces`.

### Multiple adapters

```yaml
adapters:
  - type: libsql
    default: true
    urls: [http://libsql:8080]
  - type: sqlite
    baseDir: ./.cache/sqlite/
```

Each downstream plugin selects which adapter to use via its own `database` key:

```yaml
# plugin-keyval/manifest.yaml
database: libsql
# plugin-authn/manifest.yaml
database: sqlite
```

## Dependencies and consumers

| Plugin                  | Relationship             | Typical adapter               |
|-------------------------|--------------------------|-------------------------------|
| [plugin-authn](./plugin-authn.md) | consumer       | `sqlite` or `libsql`          |
| [plugin-keyval](./plugin-keyval.md) | consumer     | `libsql` (default)            |
| [plugin-authz](./plugin-authz.md) | consumer (optional — `file`/`memory` modes do not require DB) | `sqlite` |

`plugin-database` itself has no mandatory dependencies — it is the provider of the
persistence layer. For the `provides()` / `getPlugin()` contract used by consumers,
see [Plugin System](./plugin-system.md).

## Helm and deployment

The `config:` block in the manifest automatically generates entries in `values.yaml` and
`questions.yml` (Rancher UI):

```yaml
plugins:
  database:
    libsqlUrl: "http://libsql:8080"
    libsqlReplicas: []
    libsqlAuthToken: ""
```

For the auth token, use a Secret + envFrom instead of `--set`. Helm packaging details
are in [ops/helm-charts](../ops/helm-charts.md).

## Tests and troubleshooting

### Smoke tests

```bash
# Configured adapters
curl http://localhost:8000/database/api/adapters

# Health (all)
curl http://localhost:8000/database/api/health

# SQL ping
curl -X POST http://localhost:8000/database/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT 1 AS ping"}'
```

### Common errors

| Symptom                                   | Likely cause                                                  | Action                                                                                         |
|-------------------------------------------|---------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `Tenant not found` when calling `getAdapter` | Tenant does not exist and `autoCreate=false`, or creation failed | Create manually or enable `autoCreate: true`; check logs (LibSQL Admin API auth)           |
| `SQLITE_BUSY: database is locked`         | Write concurrency on SQLite (single-writer)                   | Enable `PRAGMA journal_mode=WAL`, shorten transactions, or serialize writes via a queue        |
| `Connection refused`                      | Wrong URL, database is down, firewall                         | Verify `DATABASE_LIBSQL_URL`; test from the container with `curl`/`psql`                       |
| `Service not initialized` (HTTP 500)      | Request arrived before `onInit` completed                     | Wait for startup; check plugin initialization order                                            |
| `Adapter type "X" not configured`         | `type` in the request is not in the manifest                  | Add the adapter or fix the caller                                                              |
| `INVALID_BATON` in HRANA                  | Session expired (>30s) or invalid baton                       | Reopen the session (new request with `baton: null`)                                            |

### Debug

```bash
LOG_LEVEL=debug bun run start
```

Logs all queries — be careful, this may capture sensitive data in bind parameters.

## References

- Code: `plugins/plugin-database/`
- Worker entrypoint: `plugins/plugin-database/index.ts`
- HRANA server: `plugins/plugin-database/server/hrana/`
- Studio SPA: `plugins/plugin-database/client/`
- [Plugin System](./plugin-system.md) — `provides()` contract, hooks, execution modes
