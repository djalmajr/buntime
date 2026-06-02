---
title: Changelog
description: Reverse-chronological record of what changed in each Buntime release.
sidebar:
  order: 2
---

What changed in each release, newest first.

## v0.4.3

### Project

- **Repository moved** from `zommehq/buntime` to `djalmajr/buntime`; the documentation site is now https://buntime.djalmajr.dev.
- Default image repositories now point at `ghcr.io/djalmajr/*` to match the new owner. Chart metadata and the Helm catalog repository (`djalmajr/charts`) were updated accordingly.

## v0.4.2

### Runtime / cpanel auth (bug fixes)

- **Fixed: cpanel session did not persist and every post-login request returned 401.** The session cookie value is percent-encoded by Hono's `setCookie` on write (e.g. a root/API key containing `@` becomes `%40`), but the reader did not decode it — so the replayed cookie never matched the original key. Login succeeded (the key arrives in the request body) while all cookie-authenticated calls failed. The shared cookie parser now `decodeURIComponent`s the value symmetrically (with a safe fallback). `btk_`-prefixed generated keys (base64url) were unaffected; only keys containing reserved characters broke.
- **Fixed: session cookie issued without `Secure` behind a TLS-terminating proxy.** `isSecureRequest` only inspected the request URL, which is `http:` when the pod sits behind Cloudflare tunnel → Traefik (TLS terminated upstream). It now honors `X-Forwarded-Proto` first, so the cookie is marked `Secure` on HTTPS sites; falls back to the URL protocol for direct connections.

## v0.4.1

### Platform

- **Per-tenant Ingress automation (phase 2).** When `PLATFORM_K8S_INGRESS=true` is set in the platform worker's `.env`, every `POST /platform/api/tenants` patches a single shared Ingress (`buntime-platform` by default) — adding the host to `spec.rules` and to `spec.tls` so cert-manager extends the SAN cert. Removal is symmetric. Idempotent; creates the Ingress on the first tenant. Disabled by default so deployments with a hand-managed Ingress keep working without RBAC.
- **RBAC bundle** for the platform: `infra/platform/rbac.yaml` ships a `buntime` ServiceAccount + Role scoped to `get/list/update/patch` on the one Ingress (plus `create` for the first tenant) + RoleBinding. The chart now accepts `serviceAccount.name` and sets `serviceAccountName` on the pod when provided.
- **CSRF tests no longer 401 when `RUNTIME_ROOT_KEY` is set in `.env`.** The runtime's `apps/runtime/src/app.test.ts` clears the env in `beforeEach` of the CSRF block, so the auth gate stays open and the CSRF middleware is what's measured.

### Cleanup

- **Removed `plugin-database`, `plugin-authn`, `plugin-authz` and `packages/database`.** The libsql adapter only had `plugin-authn` as a real consumer; `plugin-authn` was `enabled: false` and coupled to Drizzle libsql + better-auth (the platform's real auth path is Keycloak per realm). `plugin-authz` cascaded. `packages/database` was zero-consumed. `@libsql/client` is removed everywhere. All Turso access now goes through `@tursodatabase/database` (local) / `@tursodatabase/sync` (embedded replica) via `openTurso` (workers) and `ApiKeyStore` (runtime), except `apps/platform` which uses `bun:sqlite` because `@tursodatabase` breaks when bundled into a worker.

## v0.4.0

### Runtime / Proxy

- **Cookie sessions no longer bypass content plugins.** Only a header credential (`X-API-Key` / `Authorization: Bearer`) skips plugin `onRequest` hooks — the automation path. A `buntime_api_key` cookie (cpanel login) no longer disables the gateway app-shell or proxy, so the admin cpanel and a front-end app-shell coexist in the same browser.
- **`plugin-proxy` forwards `x-forwarded-for` / `x-forwarded-host` / `x-forwarded-proto` + `x-real-ip`** on proxied requests, so upstreams that require them work behind the proxy.

### Charts

- Default image registry is now `ghcr.io/djalmajr/*`.

### Project

- The repository is now public and generic: client-, personal-, and local-environment identifiers were removed throughout the code, charts, and wiki in favor of neutral placeholders.
- Added a gitleaks secrets-scan to the lefthook pre-commit hook (blocks new secrets/keys from being committed).

## v0.3.2

### Runtime / Turso

- **Dynamic state now survives pod restarts.** `plugin-turso`'s `transaction()` pushes the embedded replica to the sync server after each commit in sync mode (best-effort). Previously, transactional writes — `plugin-proxy` redirect rules, `plugin-gateway` shell-excludes — lived only in the local replica and were lost on restart because the replica re-pulls authoritative state from the server on reconnect. Local mode is unchanged.

### Gateway / Proxy (docs)

- Corrected the `plugin-proxy` admin API path: rules are managed at `/redirects/admin/rules` (not `/api`). New operator runbook covers deploying apps, the micro-frontend app-shell, and proxy redirects on the Rancher-local cluster, including the auth-bypasses-the-shell gotcha.

## v0.3.1

### Namespaces

- **`@namespace/app` workers are URL-addressable.** A scoped worker stored at `<workerDir>/@team/app/<version>/` now serves at `/@team/app/...` (the `@` is kept). Gives teams (`@acme`, `@team`) or environments (`@staging`, `@production`) a separate context, complementing the physical multi-directory support. Unscoped workers keep serving at `/app/...`.
- **Namespace-scoped API-key permissions.** Keys carry a `namespaces` list (`["*"]` = full access, the default and the value for legacy/root keys). A restricted key only sees and manages its own `@scope` workers/plugins: the runtime 403s `NAMESPACE_DENIED` on management routes, gates uploads by the package scope, filters worker/plugin lists, and the cpanel FileBrowser hides folders the key cannot access. The key-create form gains a Namespaces field.

### Runtime

- **Enable/disable a worker or plugin without a restart.** `manifest.enabled` (default `true`) gates whether a worker version is served (`POST /api/workers/:scope/:name/:version/{enable,disable}`); plugins toggle via `POST /api/plugins/:name/{enable,disable}` with a live `server.reload()`. Disabled units 404 at their base path.
- Scope-aware filesystem path policies so drag-drop, upload, and management work correctly inside `@scope/...` folders.

### Cpanel

- Gateway and Redirects iframe headers unified with the Plugins/Workers surfaces; enable/disable surfaced as a FileBrowser dropdown action.

## v0.3.0

### Authentication

- Cookie-based admin sessions replace `?_key=` query params and `sessionStorage`. The cpanel logs in via `POST /api/admin/session`, receives an `HttpOnly + Secure + SameSite=Strict` cookie, and every subsequent request — including iframe-hosted plugin UIs — authenticates automatically. Session TTL is configurable via `RUNTIME_CPANEL_SESSION_TTL`.
- `X-API-Key` and `Authorization: Bearer` continue to work for CLI/automation callers; the credential extractor probes header first, then cookie.
- Six plugin manifests dropped their `publicRoutes: { ALL: ["/admin/**"] }` workaround now that the cookie travels with same-origin requests.

### Cpanel

- New file-browser UX for Workers and Plugins: drag-drop uploads, multi-select, batch ops, breadcrumb navigation, recursive folder upload via the FileSystemEntry API. A dedicated `<UploadArchiveButton>` routes archives through `/api/{workers,plugins}/upload` for extraction at the policy-controlled destination.
- Sidebar "Platform" group renamed to "Plugins" with consistent top-padding alignment.
- Header padding, content padding, and Reload/Upload button placement audited across Overview, Keys, Workers, Plugins, Gateway, and Redirects for a single visual rhythm.

### Runtime

- New `apps/runtime/src/libs/fs/{dir-info,path-policies}.ts` plus a `createFsRoutes` factory mounted twice (`/api/workers/files`, `/api/plugins/files`) — one storage abstraction with distinct path policies per surface (semver vs. flat layout).
- Trailing-slash 308 redirect from `/<base>` to `/<base>/` for worker apps with declared `entrypoint`.

### Plugins

- `plugin-deployments` retired. Its file-browser UX is now first-class in cpanel; its API surface lives in the runtime under `/api/{workers,plugins}/files`.
- `plugin-keyval` shipped disabled by default. Gateway and Redirects (proxy) read/write through `plugin-turso` directly — single source of state in production deployments.

### Helm chart

- **Turso questions overhaul**: the Rancher catalog form now exposes every operationally-relevant `tursoServer.*` knob. The "Turso Server" tab covers image, ports, resources, persistence, namespace lifecycle, and tokens. A new "Turso Backup" tab drives the snapshot CronJob (schedule, retention, image, S3 endpoint/bucket/region/credentials/pathStyle).
- Litestream questions kept but **marked DEPRECATED** in their descriptions. Litestream cannot coexist with `tursodb --sync-server` (file-lock contention) and replication fails silently — use the new Turso Backup tab instead.
- Default `image.repository` switched to `ghcr.io/djalmajr/buntime` to match the CI pipeline. Pinned `image.tag: 0.3.0`.
