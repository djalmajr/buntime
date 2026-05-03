# Change Log

## [2026-05-02] agents | proxy runtime validation gotchas

Recorded runtime validation findings from loading `@buntime/plugin-proxy` through
the real plugin loader and browser UI.

What changed:

- `apps/plugin-turso.md`, `agents/turso-implementation-handoff.md`, and
  `agents/turso-clean-session-plan.md` now document the Turso native binding
  failure mode and the need to rebuild `dist/plugin.js` bundles before runtime
  validation.
- Captured that `@tursodatabase/database` and `@tursodatabase/sync` are native
  dependency packages per the official Turso TypeScript reference.
- Captured the Darwin ARM64 local binding names that resolved the loader error:
  `@tursodatabase/database-darwin-arm64` and
  `@tursodatabase/sync-darwin-arm64`.

Why: source-level tests can pass while runtime validation fails if Bun skipped a
native optional dependency or if the runtime is still loading stale bundled
plugin code through `manifest.pluginEntry`.

## [2026-05-02] ops | runtime chart migrated to Turso settings

Migrated runtime Helm generation from legacy LibSQL/database adapter settings to
the Turso provider settings generated from `plugins/plugin-turso/manifest.yaml`.

What changed:

- `ops/helm-charts.md`, `apps/plugin-turso.md`, and `data/storage-overview.md`
  now describe `plugins.turso.*` values and generated `TURSO_*` env vars as the
  runtime chart surface.
- `agents/turso-implementation-handoff.md` and
  `agents/turso-clean-session-plan.md` now mark chart/runtime configuration as
  completed and point the next slice at remaining legacy database-adapter
  consumers/docs.
- Recorded that `@buntime/plugin-turso` is enabled by default and
  `@buntime/plugin-database` is disabled by default for manifest-driven runtime
  loading and Helm generation.
- Recorded that the runtime chart mounts `/data/turso` as `emptyDir`, making the
  Turso local file pod-local and suitable as a sync cache rather than a shared
  Kubernetes database file.

Why: KeyVal, Gateway, and Proxy now depend on Turso directly, so the runtime
chart must load the Turso provider and stop exposing `plugins.database.libsql*` /
`DATABASE_LIBSQL_*` as the active storage configuration surface.

## [2026-05-02] agents | plugin-proxy migrated to Turso

Migrated `@buntime/plugin-proxy` dynamic-rule persistence from KeyVal-backed
state to direct `@buntime/plugin-turso` storage.

What changed:

- `apps/plugin-proxy.md`, `data/storage-overview.md`, `data/keyval-tables.md`,
  `apps/plugin-keyval.md`, and `index.md` now describe proxy's current
  `proxy_rules` table and no longer present KeyVal as proxy infrastructure.
- `agents/turso-implementation-handoff.md` and
  `agents/turso-clean-session-plan.md` now point the next slice at chart/runtime
  Turso configuration instead of proxy storage migration.
- Recorded that static proxy rules still work without Turso, while dynamic rule
  mutations return `400 Dynamic rules not enabled` when Turso is unavailable.

Why: Proxy now follows the chosen `proxy -> turso` dependency graph and remains
independent from KeyVal/Database for its own operational state.

## [2026-05-02] agents | plugin-gateway migrated to Turso

Migrated `@buntime/plugin-gateway` persistence from KeyVal-backed state to
direct `@buntime/plugin-turso` storage.

What changed:

- `apps/plugin-gateway.md` and `data/storage-overview.md` now describe gateway's
  current `gateway_metrics_history` and `gateway_shell_excludes` tables.
- `agents/turso-implementation-handoff.md` and
  `agents/turso-clean-session-plan.md` now point the next consumer slice at
  `@buntime/plugin-proxy`.
- Recorded the visible API label change for dynamic shell excludes from
  `source: "keyval"` to `source: "turso"`.

Why: Gateway is now independently enableable without KeyVal/Database for its own
durable state, preserving the chosen `gateway -> turso` dependency graph.

## [2026-05-02] agents | plugin-keyval migrated to Turso

Migrated `@buntime/plugin-keyval` from `@buntime/plugin-database` to
`@buntime/plugin-turso` and updated the wiki references for the completed
consumer slice.

What changed:

- `apps/plugin-keyval.md`, `data/storage-overview.md`, and
  `data/keyval-tables.md` now describe KeyVal's current Turso-backed storage.
- `apps/plugin-turso.md`, `agents/turso-implementation-handoff.md`, and
  `agents/turso-clean-session-plan.md` now point the next slice at gateway or
  proxy instead of KeyVal.
- Recorded Turso SDK gotchas found during migration: DDL needs an exclusive
  transaction, MVCC rejects virtual tables, KeyVal search uses regular
  `kv_fts_*` tables, and BLOB key ordering uses `hex(key)` for stable reverse
  pagination.

Why: KeyVal is the first real consumer of the Turso provider, and future
sessions need the updated dependency graph plus the SDK compatibility notes.

## [2026-05-02] agents | Turso clean-session plan

Added [`agents/turso-clean-session-plan.md`](./agents/turso-clean-session-plan.md)
to summarize what the Turso migration has already completed, what the next clean
session should do, and what dependency graph guardrails must be preserved.

Also updated the Turso handoff and plugin page to record the real
`PluginLoader` smoke test that verifies the hook-only service plugin is loaded
and registered through manifest discovery.

Why: the next session needs a concise orientation document that explains both
the completed implementation slice and the next consumer migration slice without
carrying the previous conversation transcript.

## [2026-05-02] agents | plugin-turso service slice completed

Implemented the documented `@buntime/plugin-turso` service slice and updated
the wiki handoff to make the next clean-session step explicit.

What changed:

- Added the initial service contract, adapter, service implementation, plugin
  entrypoint, and colocated tests under `plugins/plugin-turso/`.
- Documented the current implementation state in
  [`apps/plugin-turso.md`](./apps/plugin-turso.md).
- Updated [`agents/turso-implementation-handoff.md`](./agents/turso-implementation-handoff.md)
  so future sessions start from the next consumer migration slice.
- Recorded a plugin-system gotcha: hook-only infrastructure plugins should omit
  `base` entirely instead of setting `base: ""`.

Why: the Turso provider now has a tested runtime service surface, and the
handoff should not continue to point agents at already-completed files.

## [2026-05-02] agents | Turso implementation handoff for clean sessions

Added `wiki/agents/turso-implementation-handoff.md` to capture the current
Turso migration decision, partial implementation state, next coding slice, SDK
notes, validation commands, and context-budget guidance for resuming in a clean
Codex session.

Why: the active Codex thread has a high compacted context cost from historical
UI/admin/runtime work plus tool, skill, memory, and AGENTS instructions. The
handoff lets a new session resume from a concise wiki entry instead of carrying
the full transcript.

## [2026-05-02] architecture | plugin-turso provider for gateway, proxy, and keyval

Recorded the refined Turso storage dependency graph:

- `@buntime/plugin-turso` is the planned core durable SQL provider.
- `@buntime/plugin-database` remains a legacy/historical multi-adapter surface,
  not the Turso implementation target.
- `@buntime/plugin-keyval` should migrate from `plugin-database` to
  `plugin-turso`.
- `@buntime/plugin-gateway` and `@buntime/plugin-proxy` should depend directly
  on `plugin-turso` for their own `gateway_*` and `proxy_*` schemas.
- The alternative `gateway/proxy -> keyval -> turso` was rejected as the
  production graph because it would make KeyVal mandatory gateway/proxy
  infrastructure. KeyVal should instead be validated through its own tests and
  integration smoke flows.

Why: gateway/proxy must remain independently enableable in Kubernetes and
single-purpose deployments, while `plugin-turso` centralizes connection, sync,
MVCC, and retry behavior for durable SQL.

## [2026-05-02] ops | Security vulnerability backlog migrated to wiki

Migrated the historical runtime vulnerability and availability audit from
`apps/runtime/roadmap/vulnerabilities.md` to
`wiki/ops/security-vulnerability-backlog.md`, with a source summary at
`wiki/sources/2026-05-02-security-vulnerability-backlog.md`.

Also updated `.wiki-guardrails.yml` so the drift audit explicitly allows the
canonical `wiki/**/*.md` files and minimal `plugins/*/README.md` package
entrypoints.

Why: `apps/runtime/plans/*.md` are being removed as legacy planning drift, while
the vulnerability audit remains operationally relevant and belongs in the
canonical wiki.

## [2026-05-02] ops | Workload kind for runtime, Turso, apps, and plugins

Clarified Kubernetes workload boundaries:

- The Turso service chart should replace legacy LibSQL as a StatefulSet because
  it owns the durable database endpoint.
- The Buntime runtime should remain a Deployment by default because it is
  compute, not the canonical database owner.
- Runtime Turso sync files are pod-local cache/state and can be ephemeral or
  per-pod PVC depending on whether unsynced writes must survive pod loss.
- `/data/apps` and `/data/plugins` should remain shared artifact volumes, not
  per-pod StatefulSet volumes, because replicas must see the same uploaded code.

Why: StatefulSet is appropriate for durable identity-bound storage, but apps and
plugins are shared deployment artifacts and runtime pods should remain scalable
unless pod-local sync durability becomes a hard requirement.

## [2026-05-02] ops | Turso service replaces legacy LibSQL chart

Clarified the Kubernetes deployment target for Turso:

- In self-hosted Kubernetes, both `sync` and `remote` modes require a Turso
  endpoint service.
- That endpoint can be external Turso Cloud or an in-cluster Turso service.
- For the local/Rancher chart family, the in-cluster Turso service should
  replace the legacy LibSQL StatefulSet chart instead of extending it.
- Runtime pods must not share one embedded database file through a RWX volume.

Why: `sync` needs a remote sync endpoint and `remote` needs a SQL-over-HTTP
endpoint. Both are service concerns distinct from the runtime pod.

## [2026-05-02] architecture | Turso Sync as Kubernetes storage mode

Refined the Turso-only storage target:

- Removed `memory` from the target storage contract for gateway/proxy.
- Local Turso files are only for local tests and single-pod deployments.
- Kubernetes deployments should use Turso Sync, with each pod owning its local
  database file and synchronizing through a remote sync server.
- `remote`/serverless Turso access remains an optional mode for deployments
  that want to avoid local files, not the baseline Kubernetes target.

Why: Turso concurrent writes solve engine-level writer concurrency, but sharing
one embedded database file across multiple Kubernetes pods still depends on
storage-backend filesystem and locking semantics.

## [2026-05-02] architecture | Turso-only durable SQL target

Clarified the storage roadmap:

- Buntime's durable SQL target is **Turso Database only**.
- Existing LibSQL/SQLite/Postgres/MySQL references document current/legacy code,
  not a long-term adapter matrix.
- `plugin-database`, `@buntime/database`, `plugin-keyval`, `plugin-authn`, the
  plugin index, and storage pages now mark adapter-specific surfaces as
  migration candidates.
- Future external database integrations can be reconsidered later, but they are
  not part of the runtime's baseline durable SQL driver.

Why: the runtime should keep the operational surface small and use Turso's
concurrent write model instead of maintaining multiple SQL drivers.

## [2026-05-02] architecture | Plugin-owned Turso storage for gateway/proxy

Recorded the storage decision for `@buntime/plugin-gateway` and
`@buntime/plugin-proxy`:

- Gateway/proxy must not depend on `@buntime/plugin-keyval` or
  `@buntime/plugin-database` just to persist their own operational state.
- Each plugin should own its persistence contract and provide at least an
  ephemeral `memory` driver plus a durable Turso Database driver.
- Turso Database is preferred over `bun:sqlite` for durable gateway/proxy state
  because Turso supports MVCC and `BEGIN CONCURRENT`, while SQLite WAL still
  allows only one writer at a time.
- The wiki now distinguishes current implementation (`plugin-keyval` backing)
  from the target architecture (plugin-owned storage).
- `plugin-keyval` now documents gateway/proxy as current consumers only, not
  long-term typical consumers.

Why: operators need to enable gateway/proxy independently in environments where
KeyVal/Database plugins are disabled, without giving up durable state in
production.

## [2026-05-02] tooling | Wiki enforcement hooks adapted from `zomme`

Adapted the wiki enforcement hook set from the sibling `zomme` monorepo to the
Buntime repository model:

- Codex now runs markdown policy checks, sensitive-path wiki consideration, and
  wiki reindexing on `PostToolUse`, plus a `SessionStart` markdown drift audit.
- Claude Code now runs markdown policy checks and wiki reindexing on
  `PostToolUse`, a `SessionStart` drift audit, and a `Stop` reminder when
  sensitive source paths changed.
- Markdown policy is Buntime-specific: canonical durable documentation belongs
  in `wiki/`; allowed repo-local markdown is limited to root agent entry points,
  minimal app/package/plugin READMEs, chart docs/release notes, `wiki/**/*.md`,
  and agent/tooling harness files.
- Existing tracked markdown outside the allowlist is treated as legacy drift and
  warns only; newly created markdown outside the allowlist is blocked.

Why: Buntime already had auto-reindex hooks, but the remaining wiki discipline
was still behavioral. These hooks make the wiki boundary, drift visibility, and
write-as-you-go ingest prompts mechanical for both Codex and Claude Code.

## [2026-05-02] runtime | app/plugin listing names come from package metadata

Clarified that `GET /api/apps` and `GET /api/plugins` use filesystem roots only
to discover package candidates. Public names and versions come from package
metadata (`manifest.yaml`, `manifest.yml`, or `package.json`); folders without
metadata are ignored because they are outside the supported app/plugin package
format.

Why: the admin UI was mixing loaded plugin names from manifests
(`@buntime/plugin-*`) with installed plugin names derived from folder names
(`plugin-*`). The canonical identity is the package metadata; directory names
are implementation details used for discovery and filesystem operations.

## [2026-05-02] docs | launch.json names reflect runtime-serves-cpanel reality

Renamed `.claude/launch.json` entries to match what they actually do:

- `cpanel-dev` → `cpanel-watch` (build-watcher, no server — runtime serves the `dist/` output)
- `plugins-dev` → `plugins-watch` (build-watchers — runtime loads each `dist/plugin.js`)

Why: the previous `*-dev` names suggested standalone dev servers. Per [`apps/cpanel.md`](./apps/cpanel.md) and [`apps/runtime.md`](./apps/runtime.md), the CPanel is a Buntime app (not a separate server) — the runtime resolves `/cpanel/*` requests by serving the static `apps/cpanel/dist/index.html` via `serveStatic` with `<base href>` injection. The watchers only emit to disk; without the runtime running, nothing reads them.

Updated [`ops/local-dev.md`](./ops/local-dev.md#launch-configurations-claudelaunchjson) with a "Standalone?" column on the launch table, an explicit caveat for `runtime-dev` (requires pre-built `dist/` for cpanel and plugins), and a "Common workflows" guide pairing watchers with a running runtime.

## [2026-05-02] tooling | Codex QMD auto-reindex hook

- Added project-local Codex hooks for the same QMD auto-reindex rule already present in Claude Code.
- Enabled `codex_hooks` in `.codex/config.toml`, added `.codex/hooks.json`, and added `.codex/hooks/wiki-reindex.sh`.
- The Codex hook runs on `PostToolUse` for `apply_patch`/`Edit`/`Write`, detects edits to `wiki/*.md`, debounces for 3 seconds, then runs `qmd --index buntime update && qmd --index buntime embed` detached.
- Kept the existing `.claude/settings.json` and `.claude/hooks/wiki-reindex.sh` hook unchanged.
- Updated `QMD.md` so future agents know both Claude Code and Codex keep the QMD index current automatically.

## [2026-05-02] tooling | `.claude/launch.json` named launch configurations

Added 4 named launch configurations to `.claude/launch.json`, mirroring the convention from the sibling `zomme` monorepo (`<thing>-dev`, `runtimeExecutable: "bun"`, `runtimeArgs`, optional `port`):

- `buntime-dev` — root `bun run dev` (runtime + cpanel + all plugins in parallel, port 8000)
- `runtime-dev` — `@buntime/runtime` alone (watch mode, port 8000)
- `cpanel-dev` — `@buntime/cpanel` build watcher (no port; runtime serves the output)
- `plugins-dev` — all `@buntime/plugin-*` in watch mode (no port; produce `dist/plugin.js`)

These don't replace `bun run dev` or the per-workspace `--filter` invocations — they just make them addressable by name to harnesses/IDE integrations that read `.claude/launch.json`. Documented in [`ops/local-dev.md`](./ops/local-dev.md#launch-configurations-claudelaunchjson).

## [2026-05-02] tooling | Auto-reindex via Claude Code `PostToolUse` hook

Added `.claude/hooks/wiki-reindex.sh` + `.claude/settings.json` so the QMD `buntime` index stays current **without depending on agent discipline**. The hook fires on `Edit`/`Write`/`MultiEdit`/`NotebookEdit` whose `file_path` is under `wiki/*.md`, debounces in a 3-second window (a burst of N edits collapses into 1 reindex), and runs `qmd update && qmd embed` detached in the background.

Why it matters: the previous reindex was a manual step the agent had to remember after every wiki edit. Forgetting once meant queries returned stale results. The hook makes the canonical-source guarantee mechanical instead of behavioral.

What still needs the manual `buntime-refresh` alias:
- Edits made outside the Claude Code harness (direct editor, scripts, teammate pushes).
- Operations that don't touch `wiki/*.md` but should reindex (e.g. context updates via `qmd context add`).

Documented in [`QMD.md`](./QMD.md#keeping-the-index-up-to-date) under "Automatic — via Claude Code hook". Smoke-tested 2026-05-02: 581 → 594 vectors after a wiki edit, hook returned exit 0 in ~50ms (synchronous part), reindex completed in background within ~5s.

Note: the hook is portable on macOS (uses a stamp-file debounce instead of `flock`, which isn't installed by default). Requires `jq` and a `qmd` binary on PATH (the patched local install — see prerequisites in `QMD.md`).

## [2026-05-02] tests | Playwright admin E2E pattern

- Added the Playwright E2E testing pattern to `wiki/agents/testing-patterns.md`.
- Documented the value threshold for E2E tests: use them for browser + real-runtime behavior, not for cosmetic visibility checks.
- Captured the admin fixture approach: build CPanel, boot an isolated runtime per test, split built-in and uploaded app/plugin roots, validate `X-API-Key`, upload archives through the UI, verify runtime side effects, and include a prefixed API case.

## [2026-05-02] docs | QMD hyphenated semantic-query fix

- Documented the third local QMD patch required by this wiki: `vec:`/`hyde:` semantic query validation must allow hyphenated terms such as `built-in`, `multi-agent`, `gpt-4`, and `client-side`.
- Captured the exact validation rule: only reject negation when `-` starts a token, while still rejecting explicit negation such as `performance -sports`.
- Added the observed build follow-up for QMD's shared SQLite `Database` interface: declare `transaction()` because migration code already uses it.
- Added focused verification commands for the structured-search test, QMD build, CLI search smoke, and explicit-negation smoke.
- Added the Codex project-local MCP configuration (`.codex/config.toml`) alongside the existing `.mcp.json` guidance, with the reminder to avoid global MCP registration for project-specific QMD indexes.

## [2026-05-02] docs | Built-in vs uploaded app/plugin roots

- Documented the canonical source classification rule: anything shipped inside the Buntime project/image is `built-in`; only configured roots outside the project/image are `uploaded`.
- Aligned the wiki with the Docker/Helm layout: `/data/.apps` and `/data/.plugins` are built-in image roots; `/data/apps` and `/data/plugins` are custom/upload roots, usually backed by PVCs.
- Updated API, CPanel, CLI, storage, environment, and Helm references so `source` and `removable` are treated as authoritative UI/API fields.
- Clarified that built-in apps/plugins are visible in admin lists but cannot be removed; upload/delete operations must target the external custom roots.

## [2026-05-02] cleanup | Removed `wiki/AGENTS.md`; slimmed `wiki/README.md`

- **Deleted `wiki/AGENTS.md`** — was 95% identical to `wiki/README.md` and contained a stale `Read all *.md files inside .agents/rules` directive (that folder no longer exists). Agents arrive at the wiki via the root [`/CLAUDE.md`](../CLAUDE.md) (which orients them) and navigate via [`./index.md`](./index.md) (the catalog) — no third entry point needed inside the wiki.
- **Slimmed `wiki/README.md`** to a 10-line landing for GitHub-facing humans: greets the visitor, points to `index.md` / `CONVENTIONS.md` / `log.md` / `QMD.md`, and defers agent-execution rules to root `/CLAUDE.md`. Removed the duplicate workspace table (lives in `index.md`) and the stale `.agents/rules/` directive.
- **Cross-ref fixes** to references that previously pointed at `wiki/AGENTS.md`:
  - `sources/initial-ingest.md` cross-references now point at `/CLAUDE.md` for the `wiki-ingest`/`wiki-query`/`wiki-lint` flow.
  - `apps/vault.md` "References found in other wiki pages" table updated to drop the `wiki/AGENTS.md` row.

Result: agent entry-point hierarchy is now linear and unambiguous — `/CLAUDE.md` (root, eager-loaded) → `wiki/index.md` (catalog) → individual pages. No third overlapping landing page inside the wiki.

## [2026-05-02] lint | health check + `agents` audience introduced

### Automatic fixes
- Added YAML frontmatter to `sources/2026-05-01-performance-rancher-{pod-load,worker-routes}.md` (were raw reports without wiki schema; missing `title/audience/sources/updated/tags/status`).
- Added both rancher reports to `index.md` Summaries table (orphans before).
- Fixed 3 broken anchors:
  - `data/keyval-tables.md` → `apps/plugin-keyval.md#testing-and-troubleshooting` → `#tests-and-troubleshooting`
  - `data/storage-overview.md` → `apps/plugin-database.md#libsql-query-flow` → `#query-flow-libsql`
  - `/CLAUDE.md` → `wiki/apps/plugin-system.md#api-modes` → `#api-modes--persistent-vs-serverless`

### New audience and folder
- Added `audience: agents` to [`CONVENTIONS.md`](./CONVENTIONS.md) — pages whose primary consumer is an automated agent (mocking patterns, scaffolding, code-gen recipes). **Behavioral *do/don't* rules stay in `/CLAUDE.md`**, never duplicated as wiki pages.
- Created `wiki/agents/` folder with first page: [`agents/testing-patterns.md`](./agents/testing-patterns.md) — `bun:test` skeleton, `WorkerPool`/`PluginContext` mock factories, Hono `app.fetch` testing, temp-dir setup, plugin lifecycle test, error testing, anti-patterns.
- `/CLAUDE.md` now instructs the agent to **check `wiki/agents/` first** when looking for how-to recipes, falling back to `apps/` (knowledge) and proposing new `agents/` pages via `/wiki-ingest` when patterns recur.

### Audit of existing pages for `agents` audience migration
- Scanned all `apps/`, `ops/`, `data/` pages by code-block density, import statements, and "Pattern/Recipe/Scaffold/Mocking" headings.
- **Conclusion: no migration recommended.** The wiki today is overwhelmingly knowledge-prose (the *what* and *why*), not how-to recipes (the *do this*). Closest candidates were considered and rejected:
  - `apps/keyval-modeling.md` — conceptual/educational (KV mindset, versionstamp, modeling design); stays `dev`.
  - `ops/local-dev.md`, `ops/helm-charts.md`, `ops/release-flow.md`, `ops/security.md` — operational reference; stay `ops`.
  - `apps/plugin-proxy.md` — configuration examples are knowledge documentation, not templates; stays `dev`.
- Future `agents/` candidates (when written): `agents/plugin-scaffolding.md`, `agents/error-class-recipes.md`, `agents/migration-recipes.md`.

### Other checks (clean)
- Cross-refs to nonexistent files: 0 (the 2 reported by the script — `./path.md` in `CONVENTIONS.md` and `sources/initial-ingest.md` — are literal template examples in fenced regions, not real links).
- Frontmatter integrity: 100% compliant after automatic fixes.
- `updated > 90 days` stale flags: 0 (all 2026-05-02).
- Business-rule leakage in `apps/`: none (the 3 grep hits — `translate-api`, `where-to-sql.ts`, `slash` — were case-insensitive substring false positives on `SLA`).
- Audience distribution: `dev: 23`, `ops: 8`, `agents: 1`, `mixed: 1` (sources/initial-ingest), structural: 6.

### QMD reindex
After the edits above, run:

```sh
qmd --index buntime update && qmd --index buntime embed
```

(Already executed by the lint script; the index now has 40 docs / ~485 vectors.)

## [2026-05-02] refactor | Eliminated `.agents/rules/`, single `CLAUDE.md` + `AGENTS.md` symlink

Removed both `.agents/rules/` directories (root + `apps/runtime/.agents/rules/`, 17 files / ~2.6k lines total). All knowledge content (architecture, deploy, dev-setup, docker, jsr-publish, monorepo, plugins, versioning, workers — and the runtime-specific architecture/development/testing-with-buntime/project-overview/conventions) was already covered by the wiki — keeping the `.agents/rules/` versions created drift risk.

**Behavioral rules** (the *do/don't* that condition agent action) consolidated into a single section in [`/CLAUDE.md`](../CLAUDE.md) at the repo root:

- Release & publishing (never run `bump-version.ts`/`git tag`/`git push` without permission; release-notes-before-publish; never publish JSR manually from CLI)
- Testing (always run `bun test` before reporting complete; `*.test.ts` colocated)
- Code style (Biome, TS strict, trailing commas, no emojis, naming conventions, `.ts` extension in imports, `@/` alias)
- Plugin development (one API mode; base path constraints; multiple paths use `:`)
- Error handling (specific error classes from `@buntime/shared/errors`; error codes in `SCREAMING_SNAKE_CASE`; log details server-side)
- Development discipline (fix lint warnings even in untouched files; `--watch` not `--hot`)

`AGENTS.md` is now a symlink to `CLAUDE.md` — single source of truth for both.

**Knowledge gotchas** that were buried in `apps/runtime/.agents/rules/development.md` were promoted to the wiki:
- `--watch` vs `--hot` (timers/cron break with `--hot`) → [`wiki/ops/local-dev.md`](./ops/local-dev.md#tldr)
- KeyVal manual edits must use `BLOB`/`Uint8Array`, not `TEXT` → [`wiki/data/keyval-tables.md`](./data/keyval-tables.md#initialization)

PgBouncer SCRAM gotcha skipped (too niche, no anchor page).

## [2026-05-02] note | `apps/vault` confirmed as work-in-progress

User confirmed that `apps/vault` is a **planned app under active development** — the current empty-scaffolding state is intentional, not a documentation gap. Page [`apps/vault.md`](./apps/vault.md) updated to drop the "pending team confirmation" framing and state explicitly that the implementation is in progress. Page remains `status: draft` until the manifest, contracts, encryption policy, and deployment format are defined.

## [2026-05-02] setup | QMD index `buntime` provisioned

- Collection `wiki` created pointing to `wiki/` with mask `**/*.md` — 37 files indexed.
- 5 hierarchical contexts added (global, `wiki/apps`, `wiki/ops`, `wiki/data`, `wiki/sources`).
- 213 chunks embedded with multilingual model `Qwen3-Embedding-0.6B` in ~35s.
- `.mcp.json` added at the repo root pointing to `qmd --index buntime mcp` — any Claude Code session opened in this repo automatically sees the index.
- Verification: `qmd --index buntime status` confirms 37 docs / 213 vectors. Test query returns relevant results.

Recommended shell rc alias:

```sh
alias buntime-refresh='qmd --index buntime update && qmd --index buntime embed'
```

## [2026-05-02] ingest | Migration of packages/keyval/docs

Conceptual content in `packages/keyval/docs/` (15 `.adoc` files in pt-BR) **had not been absorbed** by the initial agents (which only targeted the plugin server side). Migrated to a new page:

- [`wiki/apps/keyval-modeling.md`](./apps/keyval-modeling.md) (494 lines) — KV vs RDBMS mindset, key structure (binary ordering), versionstamp, operations (CRUD/atomic/listing/transactions), features (watch/FTS/queues/expiration), modeling patterns (1-1/1-N/N-N, secondary indexes, domain patterns + multi-tenancy).

`wiki/apps/packages.md` received a cross-ref to the new page.

## [2026-05-02] ingest | Buntime wiki initialization

Creation of the Buntime project knowledge base. Consolidated all documentation from `apps/runtime/docs/`, `apps/cli/`, `apps/cpanel/`, `apps/vault/`, `plugins/*/docs/`, `plugins/*/README.{md,adoc}`, `packages/*/`, `charts/`, and `.agents/rules/` into ~30 markdown pages organized by audience.

### Pages created

**`apps/` (20 pages)**:
- Runtime and shell: `runtime.md`, `worker-pool.md`, `plugin-system.md`, `micro-frontend.md`, `runtime-api-reference.md`
- Clients: `cpanel.md`, `cli.md`, `vault.md` (draft)
- Packages: `packages.md`
- Core plugins: `plugin-database.md`, `plugin-keyval.md`, `plugin-gateway.md`, `plugin-proxy.md`, `plugin-deployments.md`, `plugin-authn.md`, `plugin-authz.md`, `plugin-logs.md`, `plugin-metrics.md`, `plugin-vhosts.md`

**`ops/` (8 pages)**: `environments.md`, `local-dev.md`, `helm-charts.md`, `release-flow.md`, `jsr-publish.md`, `logging.md`, `performance.md`, `security.md`.

**`data/` (2 pages)**: `storage-overview.md`, `keyval-tables.md`.

**`sources/`**: [`initial-ingest.md`](./sources/initial-ingest.md) (detailed summary).

**Structural**: `README.md`, `AGENTS.md`, `CONVENTIONS.md`, `index.md`, `QMD.md`, `log.md`.

### Principles applied

- **Wiki as canonical source**: pages consolidate and rewrite; they do not literally copy from sources.
- **Buntime without `business/`**: there are no business rules (purely technical runtime). Rules for products that consume the runtime live in those products' own wikis, not here.
- **Cross-refs over duplication**: plugin pages reference `plugin-system.md` instead of re-documenting hooks/manifest.
- **Tables over lists**: configs/endpoints/env vars always in tabular format.
- **en-US** for prose; **English** for identifiers.

### Ambiguities catalogued during ingest

Each agent that consolidated a slice reported contradictions between sources. Summary:

| # | Source | Contradiction | Resolution |
|---|--------|---------------|------------|
| 1 | `plugin-database` | README uses headers `x-hrana-adapter`/`-namespace`; api-reference and hrana docs use `x-database-*` | Adopted `x-database-*` (2 more consistent sources) |
| 2 | `plugin-database` | `troubleshooting.adoc` references `LIBSQL_URL_0` and `/api/database/health` (incorrect) | Rewritten to `DATABASE_LIBSQL_URL` and `/database/api/health` |
| 3 | `plugin-keyval` | `limitations.adoc` cites `KvTransaction` without retry, but the type has `maxRetries`/`retryDelay` | Discrepancy recorded in the Limitations section |
| 4 | `plugin-keyval` | `metrics.adoc` uses `?format=prometheus`; api-reference has a dedicated route `/api/metrics/prometheus` | Adopted the more recent version |
| 5 | `plugin-gateway` | Manifest has `cache.*` in the schema, but runtime has cache disabled | Documented as "schema exists, runtime disabled"; `/cache/invalidate` marked legacy |
| 6 | `plugin-gateway` | `concepts/shell-routing.md` cites `PUT /shell/excludes`, absent from api-reference and README | PUT omitted (likely outdated doc) |
| 7 | `plugin-authn` | Manifest lists `google` social provider, absent from docs | Included in the table as a note |
| 8 | `plugin-authz` | README lists 4 combining algorithms, detailed docs list 3 (`first-applicable` instead of `deny-unless-permit`/`permit-unless-deny`) | Adopted list from the 3 detailed sources and historical plan |
| 9 | `plugin-authz` | README uses duplicated path `/{base}/api/authz/*`; detailed docs use `/{base}/api/*` | Adopted the shorter path |
| 10 | `plugin-vhosts` | Docs state "single-level wildcard"; code `endsWith('.' + base)` accepts multi-level | Documented actual behavior (multi-level works) |
| 11 | `apps/runtime` | `.agents/rules/workers.md` uses "ephemeral/persistent"; docs use "TTL=0/TTL>0" | Consolidated using both vocabularies |
| 12 | `packages/shared` | `.agents/rules/errors.md` documents `ConflictError`/`InternalError`, but `errors.ts` does not export them | Recorded as a known gap with workaround `new AppError(msg, code, status)` |

### Pending items

- **QMD setup**: index `buntime` not yet created. Instructions in [`QMD.md`](./QMD.md). Owner must run `qmd --index buntime collection add . --name wiki --mask "**/*.md"` and `qmd --index buntime embed`.
- **Decide the fate of original docs**: `plugins/*/docs/`, `apps/runtime/docs/`, `packages/*/README.md` remain in the repo. Now that the wiki is the canonical source, the recommendation is: (a) remove `docs/` from plugins, (b) reduce READMEs to a pointer to the wiki, (c) move `apps/runtime/docs/` to `wiki/`. This decision should be made before the next merge to `main`.
- **`apps/vault`**: very sparse documentation. Page marked `status: draft`. Confirm with the team whether `vault` is an actual planned app or an exploration directory.
- **MCP `qmd`**: register in this repo's `.mcp.json` pointing to `--index buntime` (do not register globally).
