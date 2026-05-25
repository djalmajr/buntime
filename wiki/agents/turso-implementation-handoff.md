---
title: "Turso implementation handoff"
audience: agents
sources:
  - wiki/apps/plugin-turso.md
  - wiki/apps/plugin-keyval.md
  - wiki/apps/plugin-gateway.md
  - wiki/apps/plugin-proxy.md
  - wiki/data/storage-overview.md
updated: 2026-05-02
tags: [agents, handoff, turso, storage, plugins]
status: draft
---

# Turso implementation handoff

Use this page to resume the Turso migration in a clean Codex session without carrying the long historical conversation.

## Start Here

Run the following searches first:

```sh
qmd --index buntime query "plugin-turso implementation gateway proxy keyval"
qmd --index buntime query "testing patterns plugin lifecycle mock context"
```

Then inspect:

- [`wiki/apps/plugin-turso.md`](../apps/plugin-turso.md)
- [`wiki/data/storage-overview.md`](../data/storage-overview.md)
- [`wiki/agents/testing-patterns.md`](./testing-patterns.md)

## Current Decision

`@buntime/plugin-turso` is the target durable SQL provider for Buntime.

Dependency direction:

- `plugin-keyval -> plugin-turso`
- `plugin-gateway -> plugin-turso`
- `plugin-proxy -> plugin-turso`

Do not implement `gateway/proxy -> plugin-keyval -> plugin-turso` as the production path. That would make KeyVal mandatory infrastructure for plugins that should remain independently enableable. Validate KeyVal with its own tests and, later, with an integration smoke that runs gateway, proxy, keyval, and turso together.

## Implementation State

The first five implementation slices are in place:

- `plugins/plugin-turso/package.json` exists with `@tursodatabase/database` and `@tursodatabase/sync`.
- `plugins/plugin-turso/manifest.yaml` defines local and sync configuration fields and intentionally omits `base` because this is a hook-only service plugin.
- `plugins/plugin-turso/scripts/build.ts` and `plugins/plugin-turso/tsconfig.json` exist.
- `plugins/plugin-turso/README.md` points back to the wiki.
- `bun.lock` was updated by `bun install`.
- `plugins/plugin-turso/server/types.ts` defines the public service contracts.
- `plugins/plugin-turso/server/adapter.ts` opens local/sync Turso databases and applies MVCC journal mode.
- `plugins/plugin-turso/server/service.ts` exposes one runtime-wide adapter, tracks namespaces as ownership metadata, and wraps `BEGIN CONCURRENT` transactions with retry handling.
- `plugins/plugin-turso/plugin.ts` exposes the service through `provides()`.
- `plugins/plugin-turso/plugin.test.ts` covers lifecycle, config resolution, health, namespace validation, MVCC-backed concurrent transactions, and a real `PluginLoader` smoke test for hook-only service registration.
- `@buntime/plugin-keyval` now depends on `@buntime/plugin-turso`, wraps `TursoService` in a KeyVal-owned SQL adapter, and no longer depends on `@buntime/plugin-database`.
- KeyVal search uses regular `kv_fts_*` tables instead of FTS5 virtual tables because Turso MVCC rejects virtual tables.
- KeyVal pagination orders encoded BLOB keys with `ORDER BY hex(key)` to avoid unstable reverse ordering after deletes.
- `@buntime/plugin-gateway` now optionally depends on `@buntime/plugin-turso`, owns `gateway_metrics_history` and `gateway_shell_excludes`, and no longer uses KeyVal for gateway-owned durable state.
- Gateway shell exclude API responses now report persisted dynamic excludes as `source: "turso"` instead of `source: "keyval"`.
- `@buntime/plugin-proxy` now depends on `@buntime/plugin-turso`, owns `proxy_rules`, and no longer uses KeyVal for proxy-owned dynamic rules.
- Proxy dynamic-rule CRUD continues to return `400 Dynamic rules not enabled` when Turso is unavailable; static manifest rules still work without durable storage.
- Chart/runtime generation now enables `@buntime/plugin-turso` by default,
  disables the legacy `@buntime/plugin-database` manifest, and emits
  `plugins.turso.*` values plus `TURSO_*` ConfigMap entries instead of
  `plugins.database.libsql*` and `DATABASE_LIBSQL_*`.

Validation completed for this slice:

- `bun --filter @buntime/plugin-turso test`
- `bun --filter @buntime/plugin-turso lint`
- `bun test`
- `bun run lint`

## Completed Slice

The completed service slice created:

1. `plugins/plugin-turso/server/types.ts`.
2. `plugins/plugin-turso/server/adapter.ts`.
3. `plugins/plugin-turso/server/service.ts`.
4. `plugins/plugin-turso/plugin.ts`.
5. `plugins/plugin-turso/plugin.test.ts`.

The colocated test file also includes a loader-level smoke that creates a
temporary plugin fixture, loads it through `PluginLoader`, retrieves
`@buntime/plugin-turso` from the registry, and verifies a transaction through the
provided service.

Target service shape:

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

The first concrete implementation can expose one runtime-wide database adapter and keep namespace handling as ownership metadata for future schema/table-prefix decisions.

## Next Slice

Migrate remaining legacy database-adapter consumers and documentation so active
durable storage uses `@buntime/plugin-turso`. Keep `plugin-keyval`,
`plugin-gateway`, and `plugin-proxy` on the direct `plugin-turso` path.

## SDK Notes

`@tursodatabase/database` exposes:

- `connect(path)`
- `db.exec(sql)`
- `db.prepare(sql).all(...args)`
- `db.prepare(sql).get(...args)`
- `db.prepare(sql).run(...args)`
- `db.transaction(async (...args) => { ... })`
- `db.close()`

`@tursodatabase/sync` exposes a similar database surface plus:

- `pull()`
- `push()`
- `checkpoint()`
- `stats()`

Before finalizing sync mode, inspect the installed `@tursodatabase/sync-common` `DatabaseOpts` type because the package is beta and the exact option names should be taken from installed types, not guessed.

Runtime validation gotchas:

- The Turso packages use native dependencies. On Darwin ARM64, if Bun does not install the platform optional dependencies, runtime loading fails with `Cannot find native binding`; explicit local packages are `@tursodatabase/database-darwin-arm64` and `@tursodatabase/sync-darwin-arm64`.
- Real runtime boots load `manifest.pluginEntry` (`dist/plugin.js`) when present. Rebuild migrated plugins before HTTP/UI validation so stale bundles do not keep legacy `plugin-database` or `plugin-keyval` behavior.

## Validation Commands

Run focused checks first:

```sh
bun --filter @buntime/plugin-turso test
bun --filter @buntime/plugin-keyval test
bun --filter @buntime/plugin-gateway test
bun --filter @buntime/plugin-proxy test
bun --filter @buntime/plugin-turso lint
bun --filter @buntime/plugin-keyval lint
bun --filter @buntime/plugin-gateway lint
bun --filter @buntime/plugin-proxy lint
```

Before reporting complete:

```sh
bun test
bun run lint
```

If any wiki file changes, also run:

```sh
qmd --index buntime update && qmd --index buntime embed
```

## Context Budget Note

The previous session carried a large context because it included:

- Codex Desktop system/developer instructions and tool schemas.
- The full installed skills/plugins list.
- Memory summary.
- A long compacted conversation summary.
- The full `AGENTS.md` content pasted into the prompt.
- Project-specific wiki and implementation snippets loaded during investigation.

For a clean session, start with only:

```text
Read AGENTS.md, then read wiki/agents/turso-implementation-handoff.md, and continue the plugin-turso implementation from the documented next slice.
```

Do not paste the old conversation transcript.
