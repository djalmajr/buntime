---
title: "Summary — Buntime Initial Ingest (2026-05-02)"
audience: mixed
sources:
  - .agents/rules/**
  - apps/runtime/docs/**
  - apps/runtime/README.md
  - apps/cli/README.md
  - apps/cpanel/manifest.yaml
  - apps/cpanel/src/**
  - apps/vault/**
  - plugins/*/README.md
  - plugins/*/README.adoc
  - plugins/*/docs/**
  - plugins/*/manifest.yaml
  - packages/*/README.md
  - packages/*/package.json
  - packages/shared/jsr.json
  - charts/Chart.yaml
  - charts/values.base.yaml
  - charts/release-notes.md
updated: 2026-05-02
tags: [source, initial, ingest]
status: stable
---

# Summary — Buntime Initial Ingest (2026-05-02)

## Date and Scope

- **Date:** 2026-05-02
- **Scope:** Initial ingest creating the Buntime wiki. Consolidated scattered documentation from `apps/`, `plugins/`, `packages/`, `charts/`, and `.agents/rules/` into a single canonical source in en-US following the LLM-Maintained Wiki pattern (Karpathy).
- **Output:** `wiki/` structure populated with **30+ pages** organized by audience; cross-references between pages; conventions and QMD setup documented in [`CONVENTIONS.md`](../CONVENTIONS.md) and [`QMD.md`](../QMD.md).
- **Execution:** Dispatched in parallel waves via sub-agents (1 per plugin, 1 batch per ops area, etc.) to minimize context budget.

## Pages Created

### `wiki/apps/` — technical domain (audience: dev) — 20 pages

**Runtime and shell:**

| Page | Covers | Lines |
|------|--------|-------|
| [`runtime.md`](../apps/runtime.md) | Overview, stack, startup, server core, request handling, routing | 298 |
| [`worker-pool.md`](../apps/worker-pool.md) | LRU cache, lifecycle, sliding TTL, ephemeral concurrency, isolation | 326 |
| [`plugin-system.md`](../apps/plugin-system.md) | Auto-discovery, persistent vs serverless modes, hooks, topological sort, service registry | 446 |
| [`micro-frontend.md`](../apps/micro-frontend.md) | Shell + iframes via `@zomme/frame`, MessageChannel, base path injection | 324 |
| [`runtime-api-reference.md`](../apps/runtime-api-reference.md) | REST API `/api/*`, well-known discovery, authentication (CSRF/master/keys with roles) | 401 |

**Client apps:**

| Page | Covers | Lines |
|------|--------|-------|
| [`cpanel.md`](../apps/cpanel.md) | Admin SPA UI with TanStack Router; `/admin` area with `X-API-Key` | 253 |
| [`cli.md`](../apps/cli.md) | Go TUI/CLI, SQLite profiles, plugin/app/keys commands | 268 |
| [`vault.md`](../apps/vault.md) | **Draft** — vault backend (sparse docs, early-stage code) | 103 |

**Packages:**

| Page | Covers | Lines |
|------|--------|-------|
| [`packages.md`](../apps/packages.md) | `@buntime/shared` (JSR), `@buntime/database`, `@buntime/keyval` — exports, errors, JSR workflow | 364 |

**Core plugins:**

| Page | Covers | Lines |
|------|--------|-------|
| [`plugin-database.md`](../apps/plugin-database.md) | LibSQL/SQLite/MySQL/PostgreSQL adapters, HRANA, multi-tenancy | 512 |
| [`plugin-keyval.md`](../apps/plugin-keyval.md) | Deno KV-like, atomic ops, FTS, queues, watch SSE | 420 |
| [`plugin-gateway.md`](../apps/plugin-gateway.md) | CORS + rate-limit + app shell + monitoring | 364 |
| [`plugin-proxy.md`](../apps/plugin-proxy.md) | Dynamic reverse proxy, WebSocket, public routes | 543 |
| [`plugin-deployments.md`](../apps/plugin-deployments.md) | Serverless mode, app upload/download | 333 |
| [`plugin-authn.md`](../apps/plugin-authn.md) | OIDC/Keycloak/JWT/email-password, identity, SCIM | 497 |
| [`plugin-authz.md`](../apps/plugin-authz.md) | XACML, PEP/PDP/PAP, policies, combining algorithms | 455 |
| [`plugin-logs.md`](../apps/plugin-logs.md) | In-memory logs with SSE | 335 |
| [`plugin-metrics.md`](../apps/plugin-metrics.md) | Prometheus + SSE | 420 |
| [`plugin-vhosts.md`](../apps/plugin-vhosts.md) | hostname → app mapping, multi-tenancy via wildcard | 333 |

### `wiki/ops/` — operations (audience: ops) — 8 pages

| Page | Covers | Lines |
|------|--------|-------|
| [`environments.md`](../ops/environments.md) | Runtime and plugin env var table, defaults, `/data` layout | 173 |
| [`local-dev.md`](../ops/local-dev.md) | `bun dev`, `.env`, external plugins in watch mode, Docker Compose | 272 |
| [`helm-charts.md`](../ops/helm-charts.md) | `charts/buntime` + `charts/libsql`, generation scripts, Rancher | 317 |
| [`release-flow.md`](../ops/release-flow.md) | Dual versioning, `bump-version.ts`, GitHub and self-hosted GitLab flows | 321 |
| [`jsr-publish.md`](../ops/jsr-publish.md) | `@buntime/shared` via OIDC, `jsr.json` ↔ `package.json` sync | 113 |
| [`logging.md`](../ops/logging.md) | Central logger, transports, request ID correlation | 242 |
| [`performance.md`](../ops/performance.md) | `bun run perf` harness, 4 scenarios, tuning env vars, Rancher reports | 160 |
| [`security.md`](../ops/security.md) | CSRF, request IDs, reserved paths, env filtering, body limits | 255 |

### `wiki/data/` — schemas (audience: dev) — 2 pages

| Page | Covers | Lines |
|------|--------|-------|
| [`storage-overview.md`](../data/storage-overview.md) | Store inventory: LibSQL, API keys file store, caches, PVCs; backup/DR | 132 |
| [`keyval-tables.md`](../data/keyval-tables.md) | Actual DDL for `plugin-keyval` (kv_entries, kv_queue, etc.) + reuse by `plugin-proxy` | 195 |

### `wiki/sources/` and structural

- [`initial-ingest.md`](./initial-ingest.md) — this summary.
- [`README.md`](../README.md), [`CONVENTIONS.md`](../CONVENTIONS.md), [`index.md`](../index.md), [`QMD.md`](../QMD.md), [`log.md`](../log.md). (Note: `wiki/AGENTS.md` was removed on 2026-05-02 — agent execution rules now live in repo-root [`/CLAUDE.md`](../../CLAUDE.md) with `/AGENTS.md` as a symlink.)

**Total: 30 content pages + 5 structural pages ≈ 8,500 lines of consolidated markdown.**

## Applied Principles

- **Wiki is the canonical source.** Pages consolidate and rewrite; they do not copy literally from sources. Tables over long lists. `curl` examples only for the 3–5 most useful endpoints per section.
- **No `business/`.** Buntime is a pure runtime with no business rules. Any "business" rule lives in the product consuming the runtime, not here.
- **Cross-refs over duplication.** Plugin pages reference [`plugin-system.md`](../apps/plugin-system.md) instead of re-documenting hooks and manifest schema. Consumer plugin pages reference [`plugin-database.md`](../apps/plugin-database.md) instead of re-documenting adapters.
- **en-US for prose; English for identifiers.** YAML frontmatter required on every page. Standard markdown links `[text](./path.md)`.

## Insights, Debts, and Contradictions

> Each agent that consolidated a slice reported contradictions between sources. Consolidated summary:

| # | Source | Contradiction | Resolution |
|---|--------|---------------|------------|
| 1 | `plugin-database` | HRANA headers: README uses `x-hrana-*`; api-reference and hrana docs use `x-database-*` | Adopted `x-database-*` |
| 2 | `plugin-database` | `troubleshooting.adoc` references `LIBSQL_URL_0` and `/api/database/health` (both wrong) | Rewritten to `DATABASE_LIBSQL_URL` and `/database/api/health` |
| 3 | `plugin-keyval` | `KvTransaction` "no retry" but the type exposes `maxRetries`/`retryDelay` | Discrepancy recorded under Limitations |
| 4 | `plugin-keyval` | `?format=prometheus` (legacy) vs `/api/metrics/prometheus` (current) | Adopted current version |
| 5 | `plugin-gateway` | `cache.*` schema exists but the runtime has caching disabled | Documented; `/cache/invalidate` marked legacy |
| 6 | `plugin-gateway` | `PUT /shell/excludes` in concepts but absent from README/api-reference | Omitted |
| 7 | `plugin-authn` | `google` social provider in manifest but missing from docs | Included as a note |
| 8 | `plugin-authz` | README: 4 combining algorithms; docs and historical plan: 3 (`first-applicable`) | Adopted list from the 3 detailed sources |
| 9 | `plugin-authz` | README uses `/{base}/api/authz/*`; docs use `/{base}/api/*` | Adopted shorter path |
| 10 | `plugin-vhosts` | Docs claim single-level wildcard; code accepts multi-level | Documented actual behavior |
| 11 | `apps/runtime` | Vocabulary "ephemeral/persistent" vs "TTL=0/TTL>0" | Consolidated using both |
| 12 | `packages/shared` | `.agents/rules/errors.md` documents `ConflictError`/`InternalError`; `errors.ts` does not export them | Gap recorded with workaround `new AppError(msg, code, status)` |

### General Insights

- **LibSQL as the unified default.** `plugin-database` clearly positions LibSQL as the recommended production path. Some older docs still assume plain SQLite — standardize in upcoming revisions.
- **File-backed API keys before plugins.** Important design decision (bootstrap), captured in [storage-overview](../data/storage-overview.md). Multi-pod deployments require `RUNTIME_STATE_DIR` pointing to a shared volume.
- **Rancher reports are snapshots.** [`performance-rancher-*-2026-05-01.md`](../../apps/runtime/docs/) are point-in-time — supplementary reading, not a continuous truth. Re-run and produce a new report whenever the image or pod resources change.
- **`apps/vault` is embryonic.** No `package.json`, no `manifest.yaml`, no README, no source code beyond `.dirinfo` and a minimal `.env`. Page marked `status: draft` — confirm with the team whether it is a planned app or an exploration directory.

## Pending Items

- **Decide the fate of the original docs.** Since the wiki is now the canonical source, recommended actions:
  - **Plugin docs (`plugins/*/docs/`)**: remove. Each plugin's README.md reduced to a pointer to the corresponding wiki page.
  - **Runtime docs (`apps/runtime/docs/`)**: evaluate moving to `wiki/` or keeping as historical reference (dated, non-canonical). There is currently high overlap.
  - **Package READMEs (`packages/*/README.md`)**: keep minimal (required for npm/JSR), pointing to `wiki/apps/packages.md` for full details.
  - **`charts/release-notes.md`**: keep in place (injected into `Chart.yaml` as annotation).
  - **`apps/runtime/plans/`** and **`apps/runtime/roadmap/`**: working documents — do not migrate now, but consider moving stable artifacts to `wiki/sources/` once they become consolidated decisions.
- ~~**QMD setup.**~~ ✅ **Completed on 2026-05-02.** `buntime` index provisioned: `wiki` collection (37 docs, 213 vectors), 5 hierarchical contexts, multilingual Qwen3 model. `.mcp.json` added to the repo root. Details in [`log.md`](../log.md). For maintenance, run `qmd --index buntime update && qmd --index buntime embed` after edits.
- **Confirm `vault` status.** Current page is a placeholder; team input needed.
- **Full lint pass.** Run `/wiki-lint` to validate orphaned cross-refs and identify pages that still reference non-existent paths.

## Cross-References

- [`../README.md`](../README.md) — wiki landing.
- [`../CONVENTIONS.md`](../CONVENTIONS.md) — frontmatter, links, audience, status.
- [`../index.md`](../index.md) — navigable catalog of all pages.
- [`../log.md`](../log.md) — operations log (this ingest recorded there).
- [`/CLAUDE.md`](../../CLAUDE.md) — agent execution rules and `wiki-ingest` / `wiki-query` / `wiki-lint` invocation.
