---
title: "Shared packages (@buntime/*)"
audience: dev
sources:
  - packages/shared/README.md
  - packages/shared/jsr.json
  - packages/shared/package.json
  - packages/shared/src/errors.ts
  - packages/database/package.json
  - packages/database/src/index.ts
  - packages/database/src/client.ts
  - packages/keyval/package.json
  - packages/keyval/src/index.ts
  - packages/keyval/README.adoc
  - .agents/rules/jsr-publish.md
  - .agents/rules/errors.md
updated: 2026-05-02
tags: [packages, jsr, shared, errors, database, keyval]
status: stable
---

# Shared packages

> Internal libraries of the Buntime monorepo, living in `packages/`. `@buntime/shared` is the only one published to [JSR](https://jsr.io/@buntime/shared) and therefore consumable by external plugins. `@buntime/database` and `@buntime/keyval` are private and consumed via `workspace:*` by plugins within the monorepo.

For the server side that exposes these SDKs, see [@buntime/plugin-database](./plugin-database.md) and [@buntime/plugin-keyval](./plugin-keyval.md). For the plugin system itself, see [Plugin System](./plugin-system.md).

## Overview

| Package | Path | Version | Visibility | Purpose |
|--------|------|--------|--------------|-----------|
| `@buntime/shared` | `packages/shared/` | `1.1.2` | Public (JSR + workspace) | Errors, logger, utils, plugin runtime types |
| `@buntime/database` | `packages/database/` | `1.0.0` | Private (workspace) | HTTP client that speaks HRANA with `plugin-database` |
| `@buntime/keyval` | `packages/keyval/` | `1.0.0` | Private (workspace) | KV-like client (Deno KV style) that speaks with `plugin-keyval` |

> Workspace consumers (apps and plugins in the monorepo) declare `"@buntime/<pkg>": "workspace:*"`. External plugins hosted outside the monorepo can only install `@buntime/shared` via JSR.

## @buntime/shared

A collection of reusable runtime building blocks: HTTP error classes, structured logger, parsing utilities (durations, sizes, globs, strings), manifest validation and parser, Zod helpers, and plugin contract types.

### Structure

| Directory / file | Contents |
|---------------------|----------|
| `src/errors.ts` | `AppError` and HTTP subclasses, `errorToResponse()` |
| `src/logger/` | Logger with transports (`ConsoleTransport`, `FileTransport`) |
| `src/types/plugin.ts` | Plugin contract types, manifest, worker |
| `src/types/virtual-modules.d.ts` | Types for virtual modules (excluded from JSR) |
| `src/utils/duration.ts` | `parseDurationToMs()` |
| `src/utils/size.ts` | `parseSizeToBytes()` |
| `src/utils/glob.ts` | `globToRegex()`, `matchesGlobPatterns()` |
| `src/utils/string.ts` | `splitList()` |
| `src/utils/buntime-config.ts` | Manifest and `.env` loaders |
| `src/utils/config-validation.ts` | `WorkerConfig` validation |
| `src/utils/worker-config.ts` | Worker config types, defaults, and parser |
| `src/utils/static-handler.ts` | Static file handler with SPA fallback |
| `src/utils/zod-helpers.ts` | Zod helpers (excluded from JSR) |
| `src/build.ts` | Build helpers (Bun plugins) |

### Official exports

The table below is the canonical source of what `@buntime/shared` exposes. In case of divergence between `package.json` and `jsr.json`, the consumer needs to understand which channel they are using.

| Subpath | Main contents | In `package.json` | In `jsr.json` |
|---------|-------------------|-------------------|---------------|
| `./build` | Build helpers (Bun plugins) | yes | yes |
| `./errors` | `AppError`, `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `errorToResponse` | yes | yes |
| `./logger` | `createLogger`, `getLogger`, `setLogger`, `getChildLogger`, `initLogger`, `ConsoleTransport`, `FileTransport`, types | yes | yes |
| `./types` | Plugin contract types (`BuntimePlugin`, `PluginContext`, `PluginImpl`, `WorkerConfig`, `WorkerManifest`, etc.) | yes | yes |
| `./types/virtual-modules` | Ambient declarations for virtual modules | yes | no (excluded) |
| `./utils/buntime-config` | Manifest and `.env` loaders | yes | yes |
| `./utils/config-validation` | Worker config validation | yes | yes |
| `./utils/duration` | `parseDurationToMs`, type `Duration` | yes | yes |
| `./utils/glob` | `globToRegex`, `globArrayToRegex`, `matchesGlobPatterns`, `getPublicRoutesForMethod` | yes | yes |
| `./utils/size` | `parseSizeToBytes`, type `Size` | yes | yes |
| `./utils/static-handler` | Static handler with SPA fallback | yes | yes |
| `./utils/string` | `splitList` | yes | yes |
| `./utils/worker-config` | Worker config types, defaults, and parser | yes | yes |
| `./utils/zod-helpers` | Zod helpers | yes | no (excluded) |

> `*.test.ts` files and `src/types/virtual-modules.d.ts` are in the `exclude` list of `jsr.json` and are not published to the JSR registry.

### Peer dependencies

`@buntime/shared` declares the following peers:

| Package | Range | Why |
|--------|-------|---------|
| `hono` | `^4.0.0` | `HTTPResponseError` and `ContentfulStatusCode` types in `errors.ts` |
| `typescript` | `^5.0.0` | Direct `.ts` consumption, no build step |
| `zod` | `^4.0.0` | Validation in `config-validation.ts` and `zod-helpers.ts` |

The only runtime dependency is `ms` (duration parser).

### Errors

Import from `@buntime/shared/errors`. All HTTP classes extend `AppError`, which carries a `code` (SCREAMING_SNAKE_CASE string), an HTTP `statusCode`, and optional `data`.

| Class | Status | Default code | Supports `data` in constructor |
|--------|--------|--------------|-------------------------------|
| `AppError` | configurable (default 500) | required | yes |
| `ValidationError` | 400 | `VALIDATION_ERROR` | yes |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | no |
| `ForbiddenError` | 403 | `FORBIDDEN` | no |
| `NotFoundError` | 404 | `NOT_FOUND` | no |

> **Note.** The `.agents/rules/errors.md` rule also documents `ConflictError` (409) and `InternalError` (500). As of today (2026-05-02), the file `packages/shared/src/errors.ts` does **not** export those classes — for 409/500 use `new AppError(message, code, 409)` or `new AppError(message, code, 500)` directly. Treat this as a known gap between the rule and the implementation.

#### Construction

```typescript
import { ValidationError, NotFoundError } from "@buntime/shared/errors";

throw new ValidationError("Email is required", "MISSING_EMAIL");
throw new ValidationError("Invalid input", "VALIDATION_FAILED", {
  fields: { email: "Invalid format" },
});
throw new NotFoundError("User not found", "USER_NOT_FOUND");
```

#### Error response format

`errorToResponse(error)` accepts any `Error` or `HTTPResponseError` and returns a consistent JSON `Response`.

For `AppError` and subclasses, HTTP status = `error.statusCode`, body:

```json
{
  "success": false,
  "code": "MISSING_EMAIL",
  "message": "Email is required",
  "data": { "field": "email" }
}
```

(The `data` field only appears when the error carries a payload.)

For unknown errors (not `AppError`), status = 500, body:

```json
{
  "success": false,
  "code": "INTERNAL_SERVER_ERROR",
  "message": "An unexpected error occurred"
}
```

In development (`NODE_ENV !== "production"`), `message` carries the original error text. In production, it is always `"An unexpected error occurred"` to prevent information leakage. The full stack is logged server-side via `getLogger().child("errors")`.

#### Error code conventions

Always SCREAMING_SNAKE_CASE. Common categories:

| Category | Examples |
|-----------|----------|
| Validation | `MISSING_FIELD`, `INVALID_FORMAT`, `TOO_LONG` |
| Auth | `INVALID_TOKEN`, `EXPIRED_TOKEN`, `MISSING_AUTH` |
| Not found | `USER_NOT_FOUND`, `APP_NOT_FOUND`, `RESOURCE_NOT_FOUND` |
| Permission | `ACCESS_DENIED`, `INSUFFICIENT_PERMISSIONS` |
| Conflict | `DUPLICATE_EMAIL`, `ALREADY_EXISTS` |
| Internal | `DB_ERROR`, `UNEXPECTED_ERROR` |

#### Hono integration

```typescript
import { Hono } from "hono";
import { errorToResponse } from "@buntime/shared/errors";

const app = new Hono();
app.onError((err) => errorToResponse(err));
```

### Logger

Import from `@buntime/shared/logger`. Summarized API:

| Symbol | Type | Role |
|---------|------|-------|
| `createLogger(config?)` | function | Creates a `Logger` with configured transports |
| `getLogger()` | function | Returns the global logger (creates a default on first call) |
| `setLogger(logger)` | function | Replaces the global logger |
| `getChildLogger(context)` | function | Shortcut for `getLogger().child(context)` |
| `initLogger(config?)` | function | Initializes the global logger and returns a reference |
| `ConsoleTransport` | class | Transport that writes to stdout/stderr |
| `FileTransport` | class | Transport that writes to a file |
| `Logger`, `LogEntry`, `LoggerConfig`, `LogLevel`, `LogTransport` | types | System contracts |
| `LOG_LEVEL_PRIORITY` | const | Priority map for log levels |

### Publishing to JSR

`@buntime/shared` is published to [jsr.io/@buntime/shared](https://jsr.io/@buntime/shared) **exclusively** via GitHub Actions OIDC — never via `jsr publish` in a local terminal.

Operational workflow (`.agents/rules/jsr-publish.md`):

1. Update `packages/shared/jsr.json` and `packages/shared/package.json` (versions must match).
2. Commit + push to `main`.
3. Trigger the `JSR Publish` workflow via `workflow_dispatch`:
   ```bash
   gh workflow run jsr-publish.yml
   # or with an explicit version override:
   gh workflow run jsr-publish.yml -f version=1.0.3
   ```
4. Update external consumers (plugins outside the monorepo): `bunx jsr add @buntime/shared`.

| File | Role |
|---------|-------|
| `packages/shared/jsr.json` | JSR metadata: name, version, exports, exclude |
| `packages/shared/package.json` | npm metadata; version must match `jsr.json` |
| `.github/workflows/jsr-publish.yml` | Publish workflow (OIDC, `workflow_dispatch`) |

#### Version sync

`jsr.json:version` and `package.json:version` **must always match**. Both are currently at `1.1.2`. Each bump changes both files in the same commit.

#### How to add a new export

To promote a file `src/<area>.ts` to a public export:

1. Add the entry to `package.json:exports` (workspace consumers).
2. Add the same entry to `jsr.json:exports` (JSR consumers).
3. Remove it from `jsr.json:exclude` if it was excluded.
4. Bump `version` in both files.
5. Follow the publish workflow above.

> If the module is only useful internally to `@buntime/shared` or contains ambient types (`*.d.ts`), keep it in `jsr.json:exclude`. This is exactly the case for `src/types/virtual-modules.d.ts` and `src/utils/zod-helpers.ts`.

## @buntime/database

Client SDK for the [@buntime/plugin-database](./plugin-database.md) HTTP service. This is the package that workers and apps use to speak SQL to the runtime via the HRANA protocol, without needing a native driver. For the server side, multi-tenancy, available adapters (LibSQL, SQLite, MySQL, PostgreSQL), and HRANA details, see the plugin page.

### What the package provides

- `DatabaseClient` class that speaks HRANA pipeline (`POST /database/api/pipeline`) with batching and interactive transactions (via `baton`).
- `LibSqlCompatibleClient` (`db.getRawClient()`) with a return format compatible with `@libsql/client`, allowing direct use of `drizzle-orm/libsql/http`.
- Pre-configured default export at `@buntime/database/libsql` for the common case (worker -> runtime).
- Automatic `baseUrl` resolution: respects `DATABASE_API_URL` > `RUNTIME_API_URL` (with `/database/api` suffix) > relative path `/database/api`.

### Subpaths and exports

| Subpath | Default export | Named exports |
|---------|----------------|---------------|
| `@buntime/database` | — | `createClient`, `DatabaseClient`, `LibSqlCompatibleClient`, types `AdapterType`, `DatabaseClientConfig`, `HranaColumn`, `HranaError`, `HranaPipelineReqBody`, `HranaPipelineRespBody`, `HranaStmt`, `HranaStmtResult`, `HranaValue`, `ResultSet`, `Row`, `Statement`, `Transaction` |
| `@buntime/database/libsql` | `db: DatabaseClient` (`adapter: "libsql"`) | re-exports `createClient`, `DatabaseClient`, `LibSqlCompatibleClient` and types `AdapterType`, `DatabaseClientConfig`, `ResultSet`, `Row`, `Statement`, `Transaction` |
| `@buntime/database/sqlite` | SQLite adapter | same shape as `libsql.ts` |
| `@buntime/database/mysql` | MySQL adapter | same shape as `libsql.ts` |
| `@buntime/database/postgres` | PostgreSQL adapter | same shape as `libsql.ts` |

### Typical usage

```typescript
// 1. Default — worker speaks to the default adapter (libsql)
import db from "@buntime/database/libsql";
const result = await db.execute("SELECT * FROM users");

// 2. Custom — explicit namespace + baseUrl
import { createClient } from "@buntime/database";
const db = createClient({
  adapter: "libsql",
  namespace: "my-tenant",
  baseUrl: "http://localhost:8000/database/api",
});

// 3. Drizzle ORM
import { drizzle } from "drizzle-orm/libsql/http";
import db from "@buntime/database/libsql";
import * as schema from "./schema";
const orm = drizzle({ client: db.getRawClient(), schema });
```

### How the plugin uses this package

`plugin-database` is the HRANA server: it accepts `POST /database/api/pipeline`, validates the adapter and namespace via headers, and routes to the adapter configured in `manifest.yaml`. `@buntime/database` is the client side that workers and apps embed. For the full design (multi-tenancy, HRANA headers, isolation), see [plugin-database](./plugin-database.md).

## @buntime/keyval

Client SDK for the [@buntime/plugin-keyval](./plugin-keyval.md) service. Exposes the `Kv` class (Deno KV style) with composite keys, atomic operations with versionstamps (OCC), transactions, queues, real-time watch, and full-text search. For detailed semantics of each operation, modeling, and limitations, see the plugin page.

### What the package provides

| Symbol | Type | Role |
|---------|------|-------|
| `Kv` | class | Main client: `get`, `set`, `delete`, `list`, `count`, `paginate`, `atomic`, `transaction`, `watch`, `enqueue`, `listen`, FTS, secondary indexes |
| `KvAtomicOperation` | class | Builder for checks + mutations with versionstamps (OCC) |
| `KvTransaction` | class | Interactive transaction with `commit`/`rollback` |
| `Duration` | type | Alias `number \| string` for TTLs |

### Exported types

Importable from the `@buntime/keyval` entry point:

`KvCheck`, `KvCommitError`, `KvCommitResult`, `KvCreateIndexOptions`, `KvDeleteOptions`, `KvDeleteResult`, `KvDlqListOptions`, `KvDlqMessage`, `KvEnqueueOptions`, `KvEntry`, `KvFilterOperators`, `KvFilterValue`, `KvFtsTokenizer`, `KvIndex`, `KvKey`, `KvKeyPart`, `KvListenHandle`, `KvListenOptions`, `KvListOptions`, `KvMetrics`, `KvNow`, `KvOperationMetrics`, `KvPaginateOptions`, `KvPaginateResult`, `KvQueueMessage`, `KvQueueStats`, `KvSearchOptions`, `KvSetOptions`, `KvStorageStats`, `KvTransactionError`, `KvTransactionOptions`, `KvTransactionResult`, `KvWatchCallback`, `KvWatchHandle`, `KvWatchOptions`, `KvWhereFilter`.

### Client vs server

| Side | Where it lives | Role |
|------|-----------|-------|
| Client (this package) | `packages/keyval/` | Embeds `class Kv` in any worker/app, speaks HTTP/SSE with the plugin |
| Server (plugin) | `plugins/plugin-keyval/` | Persists to SQLite via [@buntime/plugin-database](./plugin-database.md), exposes REST + SSE |

### Typical usage

```typescript
import { Kv } from "@buntime/keyval";

const kv = new Kv("http://localhost:8000/keyval/api");

await kv.set(["users", 1], { name: "Alice", email: "alice@example.com" });
const user = await kv.get(["users", 1]);

for await (const entry of kv.list(["users"])) {
  console.log(entry.key, entry.value);
}
```

### Detailed documentation

`packages/keyval/README.adoc` links to full guides in `packages/keyval/docs/`:

- `fundamentals/` — mindset, keys, versionstamp
- `operations/` — CRUD, listing, atomic, transactions
- `modeling/` — relationships, indexes, patterns
- `features/` — expiration, queues, realtime, FTS
- `limitations.adoc` — limits and gotchas

These guides are part of the package code (not the wiki). The wiki only consolidates the exposed contract. For server-side operation semantics, see [plugin-keyval](./plugin-keyval.md).

For model fundamentals (keys, versionstamp, modeling patterns), see [keyval-modeling.md](./keyval-modeling.md).

## How to consume

### Workspace (monorepo apps and plugins)

In the consumer's `package.json`:

```json
{
  "dependencies": {
    "@buntime/shared": "workspace:*",
    "@buntime/database": "workspace:*",
    "@buntime/keyval": "workspace:*"
  }
}
```

Bun resolves via `workspaces` in the root `package.json`. No publishing is needed to consume packages within the same monorepo.

### External plugins (outside the monorepo)

Only `@buntime/shared` is published. Install with:

```bash
bunx jsr add @buntime/shared
```

For `@buntime/database` and `@buntime/keyval`: an external plugin must speak directly to the server over HTTP (HRANA pipeline or `plugin-keyval` REST) — the HTTP contract types, if needed, live in `@buntime/shared/types`.

## Versioning

| Package | Current version | Strategy |
|--------|--------------|------------|
| `@buntime/shared` | `1.1.2` | SemVer; `jsr.json` and `package.json` always in sync; each bump accompanies a change in `exports` or in a public function/type signature |
| `@buntime/database` | `1.0.0` | Internal SemVer; no public registry; consumers switch versions automatically via `workspace:*` |
| `@buntime/keyval` | `1.0.0` | Same as `@buntime/database` |

> The release operations page (`wiki/ops/versioning.md`) has not been written yet. When it exists, it becomes the canonical source for the release process for the chart, runtime, CLI, and the packages described here.
