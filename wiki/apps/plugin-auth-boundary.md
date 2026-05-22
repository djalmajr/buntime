---
title: "Operator credentials: header for CLI, cookie for browser"
audience: dev
sources:
  - packages/shared/src/api-keys.ts
  - packages/shared/src/middleware/api-key.ts
  - apps/runtime/src/app.ts
  - apps/runtime/src/routes/admin.ts
  - apps/runtime/src/config.ts
  - apps/runtime/src/plugins/loader.ts
  - apps/runtime/src/libs/pool/instance.ts
  - apps/cpanel/src/contexts/api-key-auth-context.tsx
  - apps/cpanel/src/helpers/api-client.ts
  - apps/cpanel/src/helpers/admin-api.ts
  - plugins/plugin-proxy/**
  - plugins/plugin-authz/**
  - plugins/plugin-deployments/**
  - plugins/plugin-gateway/**
  - plugins/plugin-authn/**
  - plugins/plugin-logs/**
  - plugins/plugin-metrics/**
updated: 2026-05-21
tags: [plugins, auth, x-api-key, cookie, session, plugin-authn, control-plane, data-plane]
status: stable
---

# Operator credentials: header for CLI, cookie for browser

> Operator authentication in Buntime has **one identity** (the runtime API key) and **three transport channels**. The runtime validates the credential before any plugin code runs; downstream plugin `onRequest` hooks are bypassed entirely when the credential is present. This page is the canonical reference.

## The model

```
Browser  → HttpOnly cookie `buntime_api_key` (SameSite=Strict, Secure on HTTPS)
CLI      → header `X-API-Key: <key>`
SDK/lib  → header `Authorization: Bearer <key>`  (alias of X-API-Key)
```

All three channels resolve to the same `ApiKeyPrincipal` via the shared extractor [`extractApiKey`](../../packages/shared/src/middleware/api-key.ts). The runtime gate at [`apps/runtime/src/app.ts`](../../apps/runtime/src/app.ts) calls this once per request — when it returns a valid principal, the runtime substitutes the authenticated `processedReq` and **plugin `onRequest` hooks (including `plugin-authn`) are skipped for the remainder of the pipeline.** So operator traffic flows uniformly to plugin admin endpoints, regardless of which channel was used.

There is no `/admin/**` URL convention anymore. Every plugin is reached at its manifest `base` (e.g. `/gateway`, `/keys`, `/deployments`); credential validation is the runtime's job, not the plugin's URL shape.

## Issuing the cookie

The cpanel exchanges an operator key for a session cookie at boot:

```
POST /api/admin/session   { "key": "btk_..." }
  → 200 Set-Cookie: buntime_api_key=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400
  → body { authenticated: true, principal: {...} }

DELETE /api/admin/session
  → 204 Set-Cookie: buntime_api_key=; Max-Age=0
```

Lifetime is configurable via `RUNTIME_CPANEL_SESSION_TTL` (default `24h`; accepts any string the [`parseDurationToMs`](../../packages/shared/src/utils/duration.ts) helper parses — e.g. `30m`, `7d`). `Secure` is added when the request arrives via HTTPS so dev (`http://localhost:8000`) still works.

The cpanel client (`apps/cpanel/src/contexts/api-key-auth-context.tsx`) never stores the key in JavaScript. `sessionStorage` is empty after login — XSS cannot exfiltrate the credential. The cookie is invisible to JS by design.

## Why this fixes plugin micro-frontend iframes

Plugin UIs (gateway, redirects, keyval, etc.) load inside `<z-frame src="/<base>/">`. Iframes cannot inject `X-API-Key` headers on the parent's behalf — but same-origin cookies travel automatically. With the cookie model, sidebar entries under "Plugins" load without any orchestration. The previous design (sessionStorage + X-API-Key) silently broke every iframe because the runtime saw no credential and `plugin-authn` 401'd.

## Plugins do not need to gate operator routes

The runtime bypass makes the legacy `publicRoutes: { ALL: ["/admin/**"] }` boundary obsolete. The manifests have been cleaned:

- `plugin-authn`, `plugin-authz`, `plugin-gateway`, `plugin-logs`, `plugin-proxy` — `publicRoutes` block removed entirely.
- `plugin-metrics` — keeps `publicRoutes: { GET: ["/prometheus"] }` because the Prometheus scrape must be reachable WITHOUT credentials (network-gated).

`publicRoutes` is now reserved for endpoints that legitimately need to bypass authentication (health checks, Prometheus, public webhooks, etc.) — not as a workaround to let plugin admin UIs through.

If a plugin still wants finer-grained checks (role allowlist, permission, key prefix), it can mount [`createApiKeyMiddleware`](../../packages/shared/src/middleware/api-key.ts) on a subroute. The shared middleware reads `c.get("principal")` set by the runtime if the request already passed the gate — it just adds an extra layer on top.

## The shared middleware (still available)

[`@buntime/shared/middleware/api-key`](../../packages/shared/src/middleware/api-key.ts) exports `createApiKeyMiddleware({ store, rootKey?, requireRole?, requirePermission? })`. Use it when a plugin route needs role/permission gating finer than "authenticated operator". It:

1. Re-extracts the key (`X-API-Key` → `Authorization: Bearer` → cookie `buntime_api_key`).
2. Matches the optional runtime root key (synthetic `root` principal), then falls back to `ApiKeyStore.verify`.
3. Enforces a role allowlist (`["admin", "editor"]` by default) and an optional permission.
4. On success, injects the principal into `c.get("principal")`.
5. On failure, returns 401 (missing/invalid) or 403 (role/permission).

## Wiring in a client (plugin iframe)

The iframe inherits the cpanel origin, so its `fetch` calls automatically attach the cookie when `credentials: "same-origin"` is passed (the default is fine in modern browsers, but pass it explicitly for clarity):

```ts
// plugin client (gateway, authz, proxy, deployments, logs, metrics, ...)
const res = await fetch(`${BASE}/admin/rules`, { credentials: "same-origin" });

// SSE — same-origin EventSource sends cookies automatically
const sse = new EventSource(`${BASE}/admin/sse`);

// Browser-initiated download — anchors and window.location.href also carry cookies
window.location.href = `${BASE}/admin/download?path=${encodeURIComponent(path)}`;
```

There is **no shared client helper anymore**. The previous `@buntime/shared/client/api-key` (sessionStorage reader + `X-API-Key` header stamper) has been removed.

## CLI / automation

Nothing changes for non-browser consumers. Use `X-API-Key` or `Authorization: Bearer`:

```sh
curl -H "X-API-Key: $RUNTIME_ROOT_KEY" http://localhost:8000/api/admin/session
curl -H "Authorization: Bearer $RUNTIME_ROOT_KEY" http://localhost:8000/api/keys
```

The `?_key=` query-string fallback that used to exist has been **removed** — it leaked credentials into URLs, access logs, and Referer headers.

## CSRF

`apps/runtime/src/app.ts` enforces an Origin allow-list on state-changing methods for `/api/*`. The cookie-issuing endpoints (`POST/DELETE /api/admin/session`) inherit this check — same-origin cpanel requests pass, cross-origin requests are rejected before the cookie is even set. `SameSite=Strict` on the cookie itself is the second layer.

## Plugin-by-plugin status

| Plugin | Operator endpoints | Data plane | Notes |
|---|---|---|---|
| **plugin-proxy** | `/redirects/admin/rules*` | (none — `onRequest` does the proxy) | Authenticated via runtime gate; no plugin middleware. |
| **plugin-authz** | `/authz/admin/{policies,evaluate,explain}` | PEP `onRequest` reads `X-Identity` (unrelated to operator auth) | |
| **plugin-gateway** | `/gateway/admin/*` (stats/sse/config/rate-limit/logs) | `onRequest`/`onResponse` hooks for live traffic | Rate-limit keying still uses `X-Identity` from `plugin-authn` on data-plane requests. |
| _(retired)_ `plugin-deployments` | _(was `/deployments/admin/*`)_ | — | Absorbed into the cpanel Workers + Plugins tabs (`apps/cpanel/src/components/file-browser/`). The runtime exposes the same operations under `/api/{workers,plugins}/files/*`. |
| **plugin-authn** | `/auth/admin/scim/v2/**` | `/auth/login`, `/auth/api/auth/*`, `/auth/api/session`, `/auth/api/logout`, `/auth/api/providers` | SCIM is operator-only and bypassed by the runtime gate. The better-auth data plane stays as before. |
| **plugin-logs** | `/logs/admin/{,/stats,/sse,/clear}` | `POST /logs/api/ingest` (HTTP ingestion by other workers) | Mixed split. |
| **plugin-metrics** | `/metrics/admin/{,/stats,/sse}` | `GET /metrics/prometheus` (public, network-gated) | Prometheus is the only remaining `publicRoutes` entry across all core plugins. |
| **plugin-turso** | (no HTTP yet) | (no HTTP yet) | When endpoints are added, follow this model. |

## Permissions model

The shared middleware uses **role-level** authorization by default (`["admin", "editor"]`). The `ALL_PERMISSIONS` enum in [`@buntime/shared/api-keys`](../../packages/shared/src/api-keys.ts) is closed to the core surfaces (`workers:*`, `plugins:*`, `keys:*`) — plugins are intentionally not allowed to extend it. Granularity per plugin is enforced by reading `c.get("principal")` and inspecting `permissions`/`keyPrefix`/`name`.

## Why this matters

Before the migration: cpanel stored the API key in `sessionStorage`, stamped `X-API-Key` on every fetch, and plugin iframes were silently broken (no way for them to inject headers). The `/admin/**` convention was a workaround that never actually worked from cpanel because the iframe URL was `/<base>/`, not `/<base>/admin/...`.

After: one HttpOnly cookie carries the operator identity end-to-end, including into iframes. JavaScript never sees the key — XSS cannot exfiltrate it. The `/admin/**` URL convention is gone. CLI continues to work unchanged. One identity, one login, no per-plugin auth ceremony.

## Cross-references

- The cpanel bootstrap model: [`apps/cpanel`](./cpanel.md#authentication-cpanel-wide).
- Runtime API reference for session endpoints: [`runtime-api-reference`](./runtime-api-reference.md#admin-session).
- Runtime API key store: [`apps/runtime/src/libs/api-keys.ts`](../../apps/runtime/src/libs/api-keys.ts) (re-export of `@buntime/shared/api-keys`).
