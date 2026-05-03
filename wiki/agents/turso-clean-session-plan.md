---
title: "Turso clean-session plan"
audience: agents
sources:
  - wiki/agents/turso-implementation-handoff.md
  - wiki/apps/plugin-turso.md
  - wiki/data/storage-overview.md
updated: 2026-05-02
tags: [agents, clean-session, turso, storage, plugins]
status: draft
---

# Turso clean-session plan

Use this page when starting a clean Codex session for the Turso migration. It
summarizes what is already done, what the next session should do, and what it
should intentionally avoid carrying forward.

## What We Have Done

The storage direction is now explicit:

- `@buntime/plugin-turso` is the durable SQL provider target for Buntime.
- `@buntime/plugin-database` stays as a legacy/historical multi-adapter service.
- `@buntime/plugin-keyval` has migrated to `@buntime/plugin-turso`.
- `@buntime/plugin-gateway` now uses `@buntime/plugin-turso` directly for its
  `gateway_*` tables.
- `@buntime/plugin-proxy` now uses `@buntime/plugin-turso` directly for its own
  `proxy_rules` table, not through KeyVal.
- Chart/runtime generation now enables `@buntime/plugin-turso` by default,
  disables the legacy `@buntime/plugin-database` manifest, and emits
  `plugins.turso.*` / `TURSO_*` settings instead of `plugins.database.libsql*` /
  `DATABASE_LIBSQL_*`.
- Kubernetes storage should use Turso Sync, with each runtime pod owning its
  local file and synchronizing through a Turso endpoint.

The first Turso plugin slices are implemented:

- `plugins/plugin-turso/package.json`, `manifest.yaml`, `scripts/build.ts`,
  `tsconfig.json`, and `README.md` exist.
- The manifest intentionally omits `base` because this is a hook-only service
  plugin.
- `plugins/plugin-turso/server/types.ts` defines the public service, database,
  health, sync, and transaction contracts.
- `plugins/plugin-turso/server/adapter.ts` opens local or sync Turso databases
  and applies `PRAGMA journal_mode = mvcc`.
- `plugins/plugin-turso/server/service.ts` exposes a runtime-wide adapter,
  tracks namespaces as ownership metadata, and wraps `BEGIN CONCURRENT`
  transactions with retry handling.
- `plugins/plugin-turso/plugin.ts` exposes the Turso service through
  `provides()`.
- `plugins/plugin-turso/plugin.test.ts` covers direct lifecycle behavior,
  config resolution, health, namespace validation, MVCC-backed transactions,
  and a real `PluginLoader` smoke test that proves the hook-only plugin is
  discovered from a manifest and registers its service.
- `@buntime/plugin-keyval` depends on `@buntime/plugin-turso`, initializes
  `kv_*` tables through a KeyVal-owned `TursoKeyValAdapter`, and preserves KV,
  queue, atomic, metrics, watch, and search tests.
- KeyVal search is backed by regular `kv_fts_*` tables, not FTS5 virtual
  tables, because Turso MVCC rejects virtual tables.

The completed validations were:

```sh
bun --filter @buntime/plugin-turso test
bun --filter @buntime/plugin-keyval test
bun --filter @buntime/plugin-turso lint
bun --filter @buntime/plugin-keyval lint
bun test
bun run lint
qmd --index buntime update && qmd --index buntime embed
```

## What We Will Do Next

The next clean-session slice should migrate remaining legacy database-adapter
consumers and docs that still refer to `@buntime/plugin-database` as active
storage infrastructure.

Expected next work:

- Read `AGENTS.md`, then this page and
  [`turso-implementation-handoff.md`](./turso-implementation-handoff.md).
- Inspect remaining plugin code and docs for legacy LibSQL or `plugin-database`
  configuration that should become Turso configuration.
- Keep consumer domain schemas in each consumer plugin; do not add gateway/proxy
  APIs to `plugin-turso`.
- Preserve the direct dependency graph: `keyval -> turso`, `gateway -> turso`,
  and `proxy -> turso`.
- Keep tests focused on preserving existing runtime/chart contracts while
  changing the provider underneath.

After chart/runtime configuration passes, remaining slices should remove or
deprecate legacy database-adapter references that are no longer part of the
Turso-only durable SQL target.

## Clean Session Start

Start a new session with only this prompt:

```text
Read AGENTS.md, then read wiki/agents/turso-clean-session-plan.md and wiki/agents/turso-implementation-handoff.md, and migrate the next plugin-turso consumer from the documented next slice.
```

Then run these lookups:

```sh
qmd --index buntime query "plugin-turso implementation gateway proxy keyval"
qmd --index buntime query "plugin-keyval storage adapter database service schema tests"
qmd --index buntime query "testing patterns plugin lifecycle mock context"
```

Do not paste the old conversation transcript into the new session. The useful
project state is now in the wiki and in the code.

## Guardrails

- Do not implement `gateway/proxy -> keyval -> turso` as the production graph.
- Do not make KeyVal mandatory infrastructure for gateway or proxy.
- Do not add new adapter work to `@buntime/plugin-database`.
- Do not add `base: ""` to hook-only infrastructure plugin manifests.
- Rebuild migrated plugin bundles before browser/API validation; runtime boots use
  `manifest.pluginEntry` (`dist/plugin.js`) when present.
- If Turso fails with `Cannot find native binding`, check whether Bun installed
  the platform optional dependencies from `@tursodatabase/database` and
  `@tursodatabase/sync`.
- Do not skip `bun test` before reporting a coding slice complete.
- If wiki files change, update `wiki/log.md` and run
  `qmd --index buntime update && qmd --index buntime embed`.
