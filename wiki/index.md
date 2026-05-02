# Buntime Wiki

Centralized knowledge base for the **Buntime runtime** — a Bun runtime with an isolated worker pool, plugin system (core + external), and a micro-frontend shell. Covers the full monorepo: `apps/`, `plugins/`, `packages/`, `charts/`, `scripts/`.

> **Scope**: Buntime is purely technical — there are no canonical business rules. This wiki covers architecture, plugins, deploy, performance, security, and data. Rules for products that consume the runtime live in those products' own wikis, not here.

> **Local search with QMD**: concrete commands to index this wiki in [`QMD.md`](./QMD.md). Named index **`buntime`** (database at `~/.cache/qmd/buntime.sqlite`).

## Applications (`apps/`)

### Runtime and shell

| Page | Description |
|------|-------------|
| [Runtime](./apps/runtime.md) | Overview of `@buntime/runtime` — Bun + Hono, startup flow, server core, request handling, multi-layer routing |
| [Worker Pool](./apps/worker-pool.md) | LRU cache of workers, lifecycle, TTL=0 ephemeral vs TTL>0 persistent (sliding), `idleTimeout` notification-only, `maxRequests`, isolation |
| [Plugin System](./apps/plugin-system.md) | Auto-discovery, persistent vs serverless modes, manifest schema, hooks (`onInit`/`onRequest`/`onResponse`/`onShutdown`), topological sort, service registry |
| [Micro-Frontend](./apps/micro-frontend.md) | Shell + iframes via `@zomme/frame`, bidirectional MessageChannel, base path injection, framework-agnostic |
| [API Reference](./apps/runtime-api-reference.md) | REST API `/api/*` (or `/_/api/*` with prefix), discovery `/.well-known/buntime`, authentication (CSRF + master key + API keys with roles) |

### Client apps

| Page | Description |
|------|-------------|
| [CPanel](./apps/cpanel.md) | Admin SPA UI (React + TanStack Router) hosting the micro-frontend shell; `/admin` area with `X-API-Key` |
| [CLI/TUI](./apps/cli.md) | Go client that talks to the runtime via HTTP, discovers the API base via well-known, manages API keys/apps/plugins |
| [Vault](./apps/vault.md) | **Draft** — vault backend (sparse documentation, nascent code; status pending confirmation) |

### Shared packages

| Page | Description |
|------|-------------|
| [Packages (`@buntime/*`)](./apps/packages.md) | `@buntime/shared` (published on [JSR](https://jsr.io/@buntime/shared)), `@buntime/database`, `@buntime/keyval` — exports, errors, JSR workflow |
| [`@buntime/keyval` — fundamentals and modeling](./apps/keyval-modeling.md) | KV mindset, key structure, versionstamp, modeling patterns (1-1/1-N/N-N, secondary indexes), TTL, transactions — **client library side** |

### Core plugins

10 core plugins live in `plugins/`. 5 come `enabled: true` (database, gateway, keyval, proxy, deployments); the rest are opt-in (authn, authz, logs, metrics, vhosts).

| Page | Description |
|------|-------------|
| [`plugin-database`](./apps/plugin-database.md) | LibSQL/SQLite/MySQL/PostgreSQL adapters, HRANA, multi-tenancy — foundation for almost all other plugins |
| [`plugin-keyval`](./apps/plugin-keyval.md) | Deno KV-like key-value store on top of LibSQL: atomic ops, FTS, queues, where filters, watch SSE |
| [`plugin-gateway`](./apps/plugin-gateway.md) | CORS + rate-limit + app shell (micro-frontend host) + monitoring |
| [`plugin-proxy`](./apps/plugin-proxy.md) | Dynamic reverse proxy with rules stored in LibSQL (via keyval), WebSocket, public routes |
| [`plugin-deployments`](./apps/plugin-deployments.md) | **Serverless mode** — manages apps on the runtime (upload/download/list/delete) |
| [`plugin-authn`](./apps/plugin-authn.md) | OIDC/Keycloak/JWT/email-password authentication + identity model + SCIM (`enabled: false` by default) |
| [`plugin-authz`](./apps/plugin-authz.md) | XACML authorization — PEP/PDP/PAP, policies, combining algorithms (`enabled: false` by default) |
| [`plugin-logs`](./apps/plugin-logs.md) | In-memory logs with SSE streaming (`enabled: false` by default) |
| [`plugin-metrics`](./apps/plugin-metrics.md) | Prometheus metrics + SSE for dashboards (`enabled: false` by default) |
| [`plugin-vhosts`](./apps/plugin-vhosts.md) | Hostname-to-app mapping; multi-tenancy via wildcard subdomain (`enabled: false` by default) |

## Operations (`ops/`)

| Page | Description |
|------|-------------|
| [Environment variables](./ops/environments.md) | Full table of env vars for the runtime and core plugins, defaults, pool size per env, `/data` layout |
| [Local dev](./ops/local-dev.md) | `bun dev` at the root, `.env`, external plugins in watch mode, 3 modes (dev/bundle/binary), Docker Compose profiles |
| [Helm charts](./ops/helm-charts.md) | `charts/buntime` + `charts/libsql` structure, generation scripts, principles (mandatory volumes, defaults), Rancher questions |
| [Release flow](./ops/release-flow.md) | Dual versioning (chart vs runtime), `bump-version.ts`, **two flows**: GitHub Actions/GHCR/`zommehq/charts` and self-hosted GitLab/`registry.example.com` |
| [JSR publish](./ops/jsr-publish.md) | `@buntime/shared` via GitHub Actions OIDC; version sync `jsr.json` ↔ `package.json` |
| [Logging](./ops/logging.md) | Runtime central logger (`@buntime/shared/logger`), transports, request ID correlation; cross-ref to `plugin-logs` |
| [Performance](./ops/performance.md) | Local harness (`bun run perf`), 4 scenarios, tuning env vars, historical reports from Rancher |
| [Security](./ops/security.md) | CSRF, request ID, reserved paths, path traversal, sensitive env filtering, body/header limits, best practices |

## Data (`data/`)

| Page | Description |
|------|-------------|
| [Storage overview](./data/storage-overview.md) | Store inventory: LibSQL (default), API key file store, in-memory caches, PVCs `/data/apps` and `/data/plugins`; backup/DR |
| [KeyVal tables](./data/keyval-tables.md) | Real DDL for `plugin-keyval` (kv_entries, kv_queue, kv_dlq, kv_metrics, kv_indexes, FTS5) and reuse by `plugin-proxy` |

## Agents (`agents/`)

How-to references for automated agents — patterns the agent looks up at task time. Behavioral *do/don't* rules live in [`/CLAUDE.md`](../CLAUDE.md), not here.

| Page | Description |
|------|-------------|
| [Testing patterns](./agents/testing-patterns.md) | `bun:test` skeleton, `WorkerPool` and `PluginContext` mock factories, Hono `app.fetch` testing, temp-dir setup, plugin lifecycle test, error testing, anti-patterns |

## Summaries (`sources/`)

Each summary describes an ingest (or re-ingest) operation that originated or updated pages in this wiki. Operational detail lives in [`log.md`](./log.md).

| Summary | Date | Scope |
|---|---|---|
| [Initial ingest](./sources/initial-ingest.md) | 2026-05-02 | Wiki creation — consolidated `apps/`, `plugins/`, `packages/`, `charts/` and `.agents/rules/` into ~30 pages |
| [Rancher pod load test](./sources/2026-05-01-performance-rancher-pod-load.md) | 2026-05-01 | k6 against `GET /_/api/health` on the pod (Ingress + TLS + Traefik); pod CPU/mem impact |
| [Rancher worker route load test](./sources/2026-05-01-performance-rancher-worker-routes.md) | 2026-05-01 | k6 against ephemeral worker routes (`perf-noop`, `perf-echo`, `perf-slow`, `perf-ephemeral`) |
