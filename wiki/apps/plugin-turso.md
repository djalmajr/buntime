---
title: "@buntime/plugin-turso"
audience: dev
sources:
  - wiki/data/storage-overview.md
  - https://docs.turso.tech/connect/javascript
  - https://docs.turso.tech/sdk/ts/reference
  - https://docs.turso.tech/sync/usage
  - https://docs.turso.tech/sync/local-sync-server
  - https://docs.turso.tech/tursodb/concurrent-writes
updated: 2026-05-24
tags: [plugin, turso, storage, sync, k8s]
status: draft
---

# @buntime/plugin-turso

> Core infrastructure plugin that provides Turso Database access to other plugins. It replaces the previous idea of turning `@buntime/plugin-database` into the Turso target.

## Decision

`@buntime/plugin-turso` is the target durable SQL provider for Buntime.

Rules:

- `@buntime/plugin-database` stays as a legacy/historical multi-adapter plugin. Do not add new adapter work there and do not use it as the Turso migration target.
- `@buntime/plugin-keyval` has migrated from `@buntime/plugin-database` to `@buntime/plugin-turso`.
- `@buntime/plugin-gateway` and `@buntime/plugin-proxy` use `@buntime/plugin-turso` directly for durable operational state.
- `@buntime/plugin-gateway` and `@buntime/plugin-proxy` must not depend on `@buntime/plugin-keyval` just to persist their own state.
- No memory mode is part of the durable storage design. Local mode is the local/single-pod path; sync mode is the Kubernetes path.

## Rejected Alternative: Gateway/Proxy Through KeyVal

Do not implement durable gateway/proxy state as `gateway/proxy -> plugin-keyval -> plugin-turso`.

That path would validate `plugin-keyval` during gateway/proxy tests, but it makes KeyVal mandatory infrastructure for plugins that should remain independently enableable. It also couples gateway/proxy failure modes, schema needs, and performance profile to the generic KV abstraction.

Instead:

- gateway/proxy depend directly on `@buntime/plugin-turso` for their own `gateway_*` and `proxy_rules` tables;
- `plugin-keyval` should have its own migration and test suite against `@buntime/plugin-turso`;
- an integration smoke can exercise all three plugins in one environment, but that should not define the production dependency graph.

## Responsibility Boundary

`plugin-turso` owns infrastructure concerns:

- opening and closing Turso connections;
- configuring the local database path;
- configuring sync URL/token and sync lifecycle;
- applying Turso MVCC setup;
- providing helpers for `BEGIN CONCURRENT` transactions and retryable conflict errors;
- exposing health/status about local and sync state.

Consumer plugins own domain concerns:

| Consumer | Owns |
|----------|------|
| `plugin-keyval` | `kv_*` schema, KV operations, TTL, queues, FTS, metrics |
| `plugin-gateway` | `gateway_*` schema, metrics history, dynamic shell excludes |
| `plugin-proxy` | `proxy_rules` schema, dynamic proxy/redirect rules |

This keeps one Turso connection/sync policy per runtime while avoiding a generic business API in `plugin-turso`.

## Implementation State

As of 2026-05-02, the first service slice exists under
`plugins/plugin-turso/`:

- `server/types.ts` defines the public service, database, health, sync stats,
  and transaction option contracts.
- `server/adapter.ts` opens either `@tursodatabase/database` local mode or
  `@tursodatabase/sync` sync mode using the installed SDK option names
  (`path`, `url`, `authToken`) and applies `PRAGMA journal_mode = mvcc`.
- `server/service.ts` exposes one runtime-wide adapter, tracks requested
  namespaces as ownership metadata, returns health state, and wraps
  `BEGIN CONCURRENT` transactions with retry handling for busy/conflict errors.
- `plugin.ts` is a hook-only persistent plugin that exposes the service through
  `provides()`. Its manifest intentionally omits `base`; hook-only plugins
  must not set `base: ""`.
- `plugin.test.ts` covers exports, lifecycle/provides behavior, config
  resolution, MVCC-backed `BEGIN CONCURRENT`, namespace validation, and a real
  `PluginLoader` smoke test proving the hook-only plugin registers its provided
  service through manifest discovery.

## Modes

| Mode | Target | Notes |
|------|--------|-------|
| `local` | Local development, tests, single-pod deployments | Opens a local Turso database file. No remote sync server is required. |
| `sync` (single-tenant) | Legacy multi-pod with one shared database | Each pod has its own local replica file and pulls from a single fixed `TURSO_SYNC_URL`. One adapter per process. |
| **`sync` (multi-tenant)** | **Default for multi-pod / lowcode multi-database** | Set `TURSO_SERVER_URL` instead of `TURSO_SYNC_URL`. Each `connect(name)` opens a separate embedded replica synced with `<TURSO_SERVER_URL>/<name>`. Local replica files are scoped per-namespace. |

The Kubernetes baseline is **multi-tenant sync** against the in-cluster
`turso-server` (see [`wiki/ops/turso-server.md`](../ops/turso-server.md)).
Turso concurrent writes solve engine-level concurrency, but a shared file
over Kubernetes storage still depends on filesystem and locking semantics
— each pod keeps its own local file and syncs through the multi-tenant
endpoint.

### Switching modes

The plugin auto-detects the mode from env vars. Precedence (first match wins):

1. **`TURSO_SERVER_URL` set** → multi-tenant sync. Each `connect(name)` →
   `<server>/<name>`. Pod-local replicas at `<localPath dir>/<name>.db`.
   `TURSO_SERVER_TOKEN` carries the data-plane bearer.
2. **`TURSO_SYNC_URL` set** → legacy single-tenant sync. One adapter; the
   `namespace` argument to `connect()` is recorded as ownership metadata
   but does not change the connection.
3. Otherwise → `local` mode (file at `TURSO_LOCAL_PATH`).

### Transaction semantics in sync mode

`transaction({ type: "concurrent" })` is **automatically downgraded** to
`BEGIN DEFERRED` when running against a sync replica. `tursodb` rejects
`BEGIN CONCURRENT` (MVCC) while CDC is active, and the sync engine
requires CDC. The downgrade is transparent — callers still get
serializable behavior, just without MVCC retry semantics. Use explicit
`type: "exclusive"` for DDL.

#### Push-after-commit (durability)

In sync mode, `transaction()` **pushes the replica to the sync server after a
successful `COMMIT`** (best-effort — push failures are logged, not thrown; the
row lives locally and syncs on the next push). Without this, a committed write
only exists in the local replica (`/data/turso/runtime.db`) and is **lost on pod
restart**, because the replica pulls authoritative state from the server on
reconnect. This is what makes dynamic state written through a transaction —
`plugin-proxy` rules, `plugin-gateway` shell-excludes — survive a restart, the
same guarantee `ApiKeyStore` gets from its own push-after-write. Plain reads via
`connect().prepare().all()` do not transact and do not push.

> Symptom this fixes: a dynamic proxy rule created via `POST
> /redirects/admin/rules` vanished after `helm upgrade`/pod roll until the
> service pushed on commit (shipped in app `1.2.2+`). See
> [the runbook](../ops/runbook-apps-gateway-proxy.md#3-proxy-redirects-plugin-proxy).

## Chart Direction

The Buntime chart exposes Turso settings from `plugins/plugin-turso/manifest.yaml` under generated `plugins.turso.*` values. The legacy `@buntime/plugin-database` manifest is disabled by default, so Helm generation no longer emits `plugins.database.libsql*` values or `DATABASE_LIBSQL_*` env vars.

When the in-cluster `tursoServer.enabled=true`, the chart **auto-wires**
the multi-tenant URL into the runtime env:

```yaml
TURSO_SERVER_URL: http://<release>-turso:8080
TURSO_SERVER_ADMIN_URL: http://<release>-turso-admin:8081
TURSO_SERVER_TOKEN: <tursoServer.authToken>     # from Secret
```

In this mode the legacy `plugins.turso.sync.url` is unused — the plugin
ignores it once `TURSO_SERVER_URL` is present. Set
`tursoServer.enabled=false` and configure `plugins.turso.sync.*`
explicitly when pointing at an external sync endpoint that is not our
own `turso-server`.

For pure single-pod local development, leave `tursoServer.enabled=false`
and either rely on the default `local` mode or set
`plugins.turso.mode=sync` with `plugins.turso.sync.url` pointing at a
specific endpoint.

The chart README and Rancher questions still expose
`plugins.turso.mode`, `plugins.turso.localPath`, `plugins.turso.sync.url`,
and `plugins.turso.sync.authToken` for the single-tenant fallback path.

The runtime chart mounts `/data/turso` as `emptyDir`, so the local
Turso file is pod-local. In Kubernetes, use multi-tenant sync mode for
durable cross-pod state.

## Service Contract

The service boundary is a provider of database primitives:

```ts
interface TursoService {
  connect(namespace?: string): Promise<TursoDatabase>;
  health(): Promise<TursoHealth>;
  transaction<T>(
    options: TursoTransactionOptions,
    callback: (db: TursoDatabase) => Promise<T>,
  ): Promise<T>;
}
```

Namespaces should map to schema/table-prefix ownership, not to separate arbitrary adapter types. Consumers should not receive plugin-specific storage APIs from `plugin-turso`; they build their own repository layer on top of the database primitives.

## Consumer Notes

Consumer migration notes:

- KeyVal wraps `TursoService` in a local `TursoKeyValAdapter`; `plugin-turso` still exposes only database/transaction primitives.
- DDL statements must run through an `exclusive` transaction. `BEGIN CONCURRENT` rejects DDL.
- Turso MVCC rejects SQLite virtual tables, so KeyVal search uses regular `kv_fts_*` tables instead of FTS5 virtual tables.
- KeyVal orders encoded BLOB keys with `ORDER BY hex(key)` for stable reverse pagination after deletes.
- Gateway owns `gateway_metrics_history` and `gateway_shell_excludes`.
- Proxy owns `proxy_rules` for dynamic rules; static proxy rules remain manifest-only and work without durable storage.

## Native Binding Notes

`@tursodatabase/database` and `@tursodatabase/sync` use native dependencies in Node/Bun environments. The official Turso TypeScript reference classifies both packages as native dependency packages (`@tursodatabase/database`: Node.js/WASM, `@tursodatabase/sync`: Node.js native).

On macOS ARM64, a runtime boot can fail with `Cannot find native binding` if Bun does not materialize the platform optional dependencies from the base packages. The installed package manifests list these platform packages as optional dependencies:

- `@tursodatabase/database-darwin-arm64`
- `@tursodatabase/sync-darwin-arm64`

For local validation on Darwin ARM64, adding those packages explicitly to `plugins/plugin-turso` resolved the runtime loader failure. Revisit this before publishing cross-platform packages: the ideal chart/image path should install the correct platform binding for the target OS/CPU without baking a Darwin-only workaround into Linux images.

## Runtime Bundle Notes

The runtime loader uses `manifest.pluginEntry` when present, so core plugins load `dist/plugin.js` in real runtime boots. After migrating a plugin from `plugin-database`/KeyVal storage to Turso, rebuild the plugin bundle before validating through HTTP/UI. Otherwise the source tests can pass while the runtime still executes stale `dist/plugin.js` code with legacy error messages such as `Dynamic rules not enabled (plugin-keyval not configured)` or `plugin-keyval requires @buntime/plugin-database`.
