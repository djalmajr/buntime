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
| [API Reference](./apps/runtime-api-reference.md) | REST API `/api/*` (or `/_/api/*` with prefix), discovery `/.well-known/buntime`, authentication (CSRF + root key + API keys with roles) |

### Client apps

| Page | Description |
|------|-------------|
| [CPanel](./apps/cpanel.md) | Operator SPA UI (React + TanStack Router) hosting the micro-frontend shell and the runtime sections (overview / keys / workers / plugins). End-to-end `X-API-Key`; no `/admin` subpath. |

### Shared packages

| Page | Description |
|------|-------------|
| [Packages (`@buntime/*`)](./apps/packages.md) | `@buntime/shared` (published on [JSR](https://jsr.io/@buntime/shared)), `@buntime/database`, `@buntime/keyval` — exports, errors, JSR workflow |
| [`@buntime/keyval` — fundamentals and modeling](./apps/keyval-modeling.md) | KV mindset, key structure, versionstamp, modeling patterns (1-1/1-N/N-N, secondary indexes), TTL, transactions — **client library side** |

### Core plugins

10 core plugins live in `plugins/`. 5 come `enabled: true` (database, gateway, keyval, proxy, deployments); the rest are opt-in (authn, authz, logs, metrics, vhosts).

| Page | Description |
|------|-------------|
| [`plugin-database`](./apps/plugin-database.md) | Current multi-adapter database service; legacy/historical surface, not the Turso target |
| [`plugin-turso`](./apps/plugin-turso.md) | **Draft/planned** core Turso Database provider for durable SQL, local/sync modes, and Kubernetes sync topology |
| [`plugin-keyval`](./apps/plugin-keyval.md) | Deno KV-like key-value store; current storage uses plugin-database adapters, target storage uses plugin-turso |
| [`plugin-gateway`](./apps/plugin-gateway.md) | CORS + rate-limit + app shell (micro-frontend host) + monitoring |
| [`plugin-proxy`](./apps/plugin-proxy.md) | Dynamic reverse proxy; static manifest rules plus dynamic rules stored through plugin-turso |
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
| [Runbook — apps, app-shell, proxy](./ops/runbook-apps-gateway-proxy.md) | End-to-end operator steps on the Rancher-local cluster: upload/address workers, configure the gateway micro-frontend shell (`example-spa`), and proxy `/api` to a backend; with the auth-bypass + Turso-durability gotchas |
| [Release flow](./ops/release-flow.md) | Dual versioning (chart vs runtime), `bump-version.ts`, **two flows**: GitHub Actions/GHCR/`zommehq/charts` and self-hosted GitLab/`registry.example.com` |
| [JSR publish](./ops/jsr-publish.md) | `@buntime/shared` via GitHub Actions OIDC; version sync `jsr.json` ↔ `package.json` |
| [Logging](./ops/logging.md) | Runtime central logger (`@buntime/shared/logger`), transports, request ID correlation; cross-ref to `plugin-logs` |
| [Performance](./ops/performance.md) | Local harness (`bun run perf`), 4 scenarios, tuning env vars, historical reports from Rancher |
| [Security](./ops/security.md) | CSRF, request ID, reserved paths, path traversal, sensitive env filtering, body/header limits, best practices |
| [Security Vulnerability Backlog](./ops/security-vulnerability-backlog.md) | Historical 2026-01-12 security and availability audit backlog migrated from `apps/runtime/roadmap` |

## Data (`data/`)

| Page | Description |
|------|-------------|
| [Storage overview](./data/storage-overview.md) | Store inventory and storage direction: plugin-turso provider target, API key file store, in-memory caches, PVCs `/data/apps` and `/data/plugins`; backup/DR |
| [KeyVal tables](./data/keyval-tables.md) | Current DDL for `plugin-keyval` (kv_entries, kv_queue, kv_dlq, kv_metrics, kv_indexes, FTS5); target storage uses plugin-turso |

## Agents (`agents/`)

How-to references for automated agents — patterns the agent looks up at task time. Behavioral *do/don't* rules live in [`/CLAUDE.md`](../CLAUDE.md), not here.

| Page | Description |
|------|-------------|
| [Testing patterns](./agents/testing-patterns.md) | `bun:test` skeleton, `WorkerPool` and `PluginContext` mock factories, Hono `app.fetch` testing, temp-dir setup, plugin lifecycle test, error testing, anti-patterns |
| [Turso clean-session plan](./agents/turso-clean-session-plan.md) | What has been completed for `plugin-turso`, what the next clean session should do, and guardrails for the next consumer migration |
| [Turso implementation handoff](./agents/turso-implementation-handoff.md) | Clean-session handoff for implementing `plugin-turso` and migrating `keyval`, `gateway`, and `proxy` storage dependencies |

## Summaries (`sources/`)

Each summary describes an ingest (or re-ingest) operation that originated or updated pages in this wiki. Operational detail lives in [`log.md`](./log.md).

| Summary | Date | Scope |
|---|---|---|
| [Initial ingest](./sources/initial-ingest.md) | 2026-05-02 | Wiki creation — consolidated `apps/`, `plugins/`, `packages/`, `charts/` and `.agents/rules/` into ~30 pages |
| [Security vulnerability backlog migration](./sources/2026-05-02-security-vulnerability-backlog.md) | 2026-05-02 | Migrated historical runtime/plugin/package security and availability audit from `apps/runtime/roadmap` |
| [Rancher pod load test](./sources/2026-05-01-performance-rancher-pod-load.md) | 2026-05-01 | k6 against `GET /_/api/health` on the pod (Ingress + TLS + Traefik); pod CPU/mem impact |
| [Rancher worker route load test](./sources/2026-05-01-performance-rancher-worker-routes.md) | 2026-05-01 | k6 against ephemeral worker routes (`perf-noop`, `perf-echo`, `perf-slow`, `perf-ephemeral`) |
