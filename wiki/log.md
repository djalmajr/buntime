# Change Log

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
