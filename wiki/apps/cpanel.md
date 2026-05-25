---
title: "@buntime/cpanel"
audience: dev
sources:
  - apps/cpanel/manifest.yaml
  - apps/cpanel/src/**
  - apps/runtime/docs/admin-console.md
updated: 2026-05-19
tags: [cpanel, micro-frontend, react, tanstack, bootstrap]
status: stable
---

# @buntime/cpanel

> React SPA that serves as the Buntime **operator shell** and **bootstrap entrypoint**. It hosts plugin UIs via iframes (web component `<z-frame>`), exposes first-class runtime sections (`/cpanel/overview`, `/cpanel/keys`, `/cpanel/apps`, `/cpanel/plugins`) for API-key/app/plugin management without relying on the CLI/TUI, and discovers the real API path through `/.well-known/buntime`. The entire cpanel authenticates end-to-end against the core runtime via an **HttpOnly session cookie** issued by `POST /api/admin/session` — it deliberately bypasses [`plugin-authn`](./plugin-authn.md) so it remains usable in a fresh deploy where no plugin is yet installed or configured. See [Operator credentials](./plugin-auth-boundary.md).

## Overview

The CPanel is distributed as a **Buntime app** (not a plugin): it has a `manifest.yaml`, is deployed as a static worker, and is accessible at `/cpanel/`. There is **no `/cpanel/admin` subpath** — everything is cpanel. Its surface is twofold:

| Role | Description |
|---|---|
| Runtime sections | First-class routes under `/cpanel/`: `overview` (operator dashboard), `keys` (API keys CRUD), `apps` (deployed apps), `plugins` (installed plugins). All gated by the session cookie. |
| Micro-frontend shell | Renders the unified sidebar and hosts plugin UIs in iframes via `<z-frame>` (`@zomme/frame`). Plugin paths are siblings of the runtime sections (e.g. `/cpanel/gateway`, `/cpanel/metrics`). |
| File browser | Workers + Plugins tabs use a shared `<FileBrowser>` over the runtime's `/api/{workers,plugins}/files/*` endpoints — drag-drop upload, multi-select, rename/move/delete, recursive folder upload (replaces the retired `plugin-deployments`). See [Operator credentials](./plugin-auth-boundary.md) for the auth model. |

Both surfaces share a **single unified sidebar** and **a single auth gate** — the user signs in once with an API key and sees, in the same shell, a "Runtime" group (Overview/Keys/Workers/Plugins) and a "Plugins" group listing every installed plugin's micro-frontend. The Runtime "Plugins" item (install/manage page) is distinct from the "Plugins" section heading (plugin-contributed menus) — hierarchy disambiguates. See [Bootstrap independence](#bootstrap-independence).

The same cookie opens the **operator endpoints of core plugins** (Proxy, Authz, Gateway, Logs, Metrics, Authn SCIM). The runtime validates the cookie before any plugin `onRequest` hook runs — see [Operator credentials](./plugin-auth-boundary.md). The legacy `/admin/**` URL convention has been retired (and `publicRoutes` blocks removed from the plugin manifests).

## Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Routing | TanStack Router (file-based, generated in `routeTree.gen.ts`) |
| Data fetching | TanStack Query |
| Web component frame | `@zomme/frame` (`<z-frame>`) |
| Forms | React Hook Form + Zod (via `@hookform/resolvers`) |
| Tables | TanStack Table |
| Components | Radix UI primitives + shadcn-style wrappers |
| Editor | CodeMirror 6 (`@uiw/react-codemirror` + lang-json/html) |
| i18n | i18next + `@zomme/bun-plugin-i18next` (`pt`, `en`) |
| Styling | Tailwind CSS v4 |
| Build | `bun scripts/build.ts` (custom Bun bundler with TSR, Tailwind, Iconify, i18next plugins) |

The final bundle is placed in `dist/` with `index.html` as the entrypoint. Code splitting happens automatically via Bun, generating multiple `chunk-*.js` files.

## Manifest and visibility

`apps/cpanel/manifest.yaml`:

```yaml
entrypoint: dist/index.html
visibility: protected
injectBase: true
publicRoutes:
  GET:
    - /**
```

| Field | Behavior |
|---|---|
| `entrypoint: dist/index.html` | Bun serves the SPA from the bundled `index.html` |
| `visibility: protected` | **Cosmetic only** — affects how the cpanel appears in the deployments UI (read-only), does **not** govern auth |
| `injectBase: true` | Runtime injects `<base href="/cpanel/">` so TanStack Router can compute `basepath` correctly |
| `publicRoutes.GET: /**` | The entire cpanel bypasses [`plugin-authn`](./plugin-authn.md). All GETs serve the static SPA bundle; writes happen against the core runtime API which validates the operator credential (cookie / header) before any plugin hook runs |

The cpanel is the bootstrap entrypoint of the runtime — see [Bootstrap independence](#bootstrap-independence). The login form POSTs the API key to `/api/admin/session`; the runtime sets the HttpOnly `buntime_api_key` cookie and the browser attaches it to every subsequent same-origin request (cpanel API calls plus plugin iframes). JavaScript never holds the credential. The runtime gate at `apps/runtime/src/app.ts` validates the cookie/header on each request and bypasses plugin `onRequest` hooks when valid.

The client-side `basepath` discovery reads the injected `<base>` tag:

```ts
// apps/cpanel/src/index.tsx
function getBasePath(): string {
  const base = document.querySelector("base");
  if (base?.href) {
    const url = new URL(base.href);
    return url.pathname.replace(/\/$/, "") || "/";
  }
  return "/";
}
```

This is why the same bundle works with the `/cpanel/` prefix (default), `/admin-panel/`, or wherever the operator mounts it.

## Folder structure

```text
apps/cpanel/
├── manifest.yaml
├── package.json
├── scripts/build.ts        # custom Bun bundler
├── src/
│   ├── index.tsx           # React entry
│   ├── index.html          # HTML template
│   ├── index.css           # tailwind base
│   ├── routeTree.gen.ts    # generated by TSR plugin
│   ├── routes/             # file-based routes (TanStack Router)
│   │   ├── __root.tsx       # global ApiKey auth gate + unified MainLayout
│   │   ├── index.tsx        # redirects /  →  /overview
│   │   ├── overview.tsx     # runtime dashboard
│   │   ├── keys.tsx         # API keys CRUD
│   │   ├── apps.tsx         # deployed apps
│   │   ├── plugins.tsx      # installed plugins
│   │   ├── $.tsx            # catch-all (plugin iframe host)
│   │   └── locales/         # pt.json, en.json
│   ├── components/
│   │   ├── auth/
│   │   │   ├── api-key-login.tsx
│   │   │   └── loading-splash.tsx
│   │   └── admin/                  # internal namespace (no /admin URL)
│   │       ├── shared.tsx          # helpers, atoms (SourceBadge, Section, ...)
│   │       └── tabs/
│   │           ├── overview.tsx
│   │           ├── keys.tsx
│   │           ├── apps.tsx
│   │           └── plugins.tsx
│   ├── contexts/
│   │   ├── api-key-auth-context.tsx # ApiKeyAuthProvider, useApiKey
│   │   └── header-context.tsx       # HeaderProvider, useHeader (routes inject actions)
│   ├── helpers/
│   │   ├── api-client.ts        # generic HTTP client (discovers /api via well-known)
│   │   ├── admin-api.ts         # types + endpoints for the runtime API surface
│   │   ├── upload-validation.ts # app/plugin package validation
│   │   ├── i18n.ts
│   │   └── query-client.ts
│   ├── hooks/
│   ├── types/
│   └── utils/
└── dist/                   # build output
```

## Authentication (cpanel-wide)

A single HttpOnly session cookie covers the entire cpanel — every runtime section (`/cpanel/overview`, `/cpanel/keys`, `/cpanel/apps`, `/cpanel/plugins`) and every plugin UI mounted via `<z-frame>`. The root layout (`apps/cpanel/src/routes/__root.tsx`) reads `useApiKey().status` and renders the login form before any route component is mounted.

- The entry form POSTs the API key to `POST /api/admin/session`. The runtime validates it against `ApiKeyStore` (or matches `RUNTIME_ROOT_KEY`) and replies with `Set-Cookie: buntime_api_key=<key>; HttpOnly; SameSite=Strict; Path=/`.
- The cookie is `Secure` when the request arrives via HTTPS; on plain `http://localhost:8000` it's marked non-secure so dev still works.
- Lifetime is configurable via `RUNTIME_CPANEL_SESSION_TTL` (default `24h`).
- JavaScript never sees the key — `sessionStorage` is empty, XSS cannot exfiltrate the credential.
- Initial probe: `GET /api/admin/session` — the browser auto-attaches the cookie. If the response is 200 the SPA renders; on 401 the login form is rendered.
- Sign out: `DELETE /api/admin/session` clears the cookie (`Max-Age=0`).
- The cpanel never sends `Authorization`; it has nothing to do with `plugin-authn` sessions.

```http
POST /api/admin/session
Content-Type: application/json

{"key": "btk_..."}
```

The cookie travels automatically on **same-origin** requests including `<iframe>`-initiated fetches and `<a download>` URLs — that's why the "Plugins" sidebar entries (Gateway, Redirects, KeyVal, etc.) load without any auth-related orchestration.

In environments with `RUNTIME_API_PREFIX="/_"` (e.g., Rancher), the real path is `POST /_/api/admin/session`. Note that the **API endpoint** still lives under `/api/admin/session` (it is the core runtime's admin-session endpoint, not a cpanel path). The cpanel **URL paths** have no `/admin` segment.

### Runtime sections

The cpanel's runtime sections are first-class routes under `/cpanel/`, each managing one slice of the runtime. Canonical reference for the underlying API at [`apps/runtime/docs/admin-console.md`](./runtime-api-reference.md); the summary below covers what belongs to the CPanel layer.

### Profiles and capabilities

Real authorization remains on the runtime side. The frontend uses the `capabilities` returned by `/api/admin/session` only to show or hide actions.

| Profile | Expected use |
|---|---|
| `admin` | Full administration, including key creation and revocation |
| `editor` | Deploy and remove apps/plugins, without managing keys |
| `viewer` | Read access to apps, plugins, workers, and keys |
| `custom` | Individually selected permissions |

`RUNTIME_ROOT_KEY` appears as the synthetic principal `root` (`isRoot: true`, `role: admin`, full access). **Recommendation**: use the root key only for bootstrap and create a dedicated `admin` or `editor` key for browser use.

### Granular permissions

Defined in `helpers/admin-api.ts`:

```text
workers:read · workers:install · workers:remove · workers:restart
plugins:read · plugins:install · plugins:remove · plugins:config
keys:read · keys:create · keys:revoke
```

A "worker" here is a deployed serverless artifact served by the WorkerPool —
the runtime treats apps and workers as the same concept (pre-2026-05-19 the
two vocabularies coexisted with `apps:*` for filesystem ops and `workers:*`
for runtime ops; they collapsed into one set).

Orthogonal to permissions, each key carries a **namespaces** list that scopes
*which* `@scope` workers/plugins it can see and manage — the key-create Sheet
exposes a Namespaces field (default `*`). See
[namespace-scoped access control](../ops/security.md#namespace-scoped-access-control).

### Features

| Section | Path | Operations |
|---|---|---|
| Overview | `/cpanel/overview` | Operator dashboard: principal info, capability matrix, counts (apps / plugins / keys / permissions) |
| API keys | `/cpanel/keys` | List (non-revoked), create by profile (`admin`/`editor`/`viewer`/`custom`), display the generated secret once, revoke (except the key in use) |
| Workers | `/cpanel/workers` | List workers in `workerDirs`, show `built-in` vs `uploaded` origin, upload (`POST /api/workers/upload`) `.zip`/`.tgz`/`.tar.gz`, remove an entire uploaded worker or a specific uploaded version |
| Plugins | `/cpanel/plugins` | List installed/loaded plugins, show `built-in` vs `uploaded` origin, upload (`POST /api/plugins/upload`), `POST /api/plugins/reload`, remove uploaded plugins and reload |

Client-side package validation lives in `helpers/upload-validation.ts` (extension, size, presence of `manifest.yaml` or `package.json`). The same package semantics apply to any automation hitting `POST /api/workers/upload` or `POST /api/plugins/upload` directly.

The UI treats `removable=false` as authoritative. Built-in rows remain visible
for inspection but do not render delete actions; the runtime enforces the same
rule server-side with `403` errors.

## Micro-frontend shell

For plugins that expose a UI, the CPanel hosts each UI in an iframe managed by the `<z-frame>` web component (registered in `index.tsx`). The catch-all route `routes/$.tsx` resolves the plugin by path and renders the appropriate frame.

| Aspect | Detail |
|---|---|
| Web component | `<z-frame>` from the `@zomme/frame` package |
| Discovery | `/.well-known/buntime` returns the `apiPrefix` and the UI catalog |
| Plugin auth (inside the iframe) | Continues to be governed by [`plugin-authn`](./plugin-authn.md) for the plugin's own endpoints — the iframe is a separate origin context. The cpanel shell itself is **not** protected by `plugin-authn`. |
| Unified navigation | The cpanel sidebar lists runtime sections (group "Runtime": Overview/Keys/Apps/Plugins) and plugin menus (group "Platform") side-by-side, permission-filtered. Both share the breadcrumb header and the global logout button in the sidebar footer. |

## Discovery via `/.well-known/buntime`

The HTTP client (`helpers/api-client.ts`) queries `/.well-known/buntime` to discover:

- The real `apiPrefix` (`/api` by default; `/_/api` when `RUNTIME_API_PREFIX="/_"`)
- The list of available plugin UIs
- Runtime metadata

This allows the same CPanel bundle to work under any prefix configured by the operator, without a rebuild.

## Bootstrap independence

The cpanel is intentionally the **first thing that works** in a fresh deploy. Because plugins (including `plugin-authn`) are themselves installed and configured through the cpanel, the cpanel cannot afford to depend on any plugin for its own access control. The runtime ships `RUNTIME_ROOT_KEY` as the synthetic principal `root` (full access), which is enough to enter the cpanel on day zero and bootstrap everything else.

### Day-zero flow

1. Operator deploys the runtime with `RUNTIME_ROOT_KEY=<secret>` set in the environment.
2. Operator opens `/cpanel/` in a browser → the cpanel calls `GET /api/admin/session`; no cookie yet → 401 → renders `ApiKeyLogin` (no plugin involved).
3. Operator pastes the root key → the cpanel `POST`s to `/api/admin/session`. The runtime validates and sets the `buntime_api_key` HttpOnly cookie. The SPA mounts the shell at `/cpanel/overview`.
4. Operator goes to `/cpanel/keys` → creates a dedicated `admin` (or `editor`) API key for daily use and signs out + back in with that key (the new key replaces the root key in the cookie).
5. Operator uploads/installs `plugin-authn` and any other plugin (and any provider config) via `/cpanel/plugins` → calls `POST /api/plugins/reload`.
6. Other apps and plugin UIs (mounted under their own bases) become protected by `plugin-authn` from this point on. The cpanel itself remains outside that gate.

### Why bypass `plugin-authn` for the cpanel?

| Constraint | Implication |
|---|---|
| The cpanel is where you install/configure plugins | If the cpanel required `plugin-authn`, day-zero access would be impossible |
| The cpanel is where you create API keys | If keys were governed by `plugin-authn` sessions, key creation would chase its own tail |
| Distinct auth surface | `plugin-authn` uses sessions (cookies) for end users; the cpanel uses runtime-managed API keys for operators |
| Single source of truth | A single cookie issued by the runtime gates the entire cpanel (same-origin SPA + iframes); CLI continues to use the `X-API-Key` header against the same backend |

Other apps and plugin UIs continue to be governed by `plugin-authn` exactly as before — see [`plugin-authn`](./plugin-authn.md). The two auth systems coexist without conflict and are orthogonal.

## Build and development

```bash
# dev (watch)
cd apps/cpanel
bun dev

# production
bun run build

# quality
bun run lint        # biome + tsc --noEmit
bun test
```

Build artifacts go to `dist/`. In CI/CD, the CPanel package is generated with the same workflow as the other Buntime apps (see [release flow](../ops/release-flow.md)).

## Access in Rancher environments

```text
https://buntime.home/cpanel/              # redirects to /cpanel/overview
https://buntime.home/cpanel/overview      # operator dashboard
https://buntime.home/cpanel/keys          # API keys management
https://buntime.home/cpanel/apps          # deployed apps
https://buntime.home/cpanel/plugins       # installed plugins
https://buntime.home/cpanel/gateway       # plugin UI (example — varies per installed plugin)
https://buntime.home/.well-known/buntime  # discovery
https://buntime.home/_/api/admin/session  # real endpoint (with RUNTIME_API_PREFIX=/_)
```

## Security

| Guarantee | How it is enforced |
|---|---|
| Secret never reaches JS | HttpOnly cookie — `document.cookie` cannot read it; XSS cannot exfiltrate it |
| SameSite=Strict | Cookie is not sent on cross-site navigations or third-party iframes — only on first-party same-origin requests |
| Secure on HTTPS | When the request arrives over TLS, the cookie is marked `Secure` so it never leaks over plaintext |
| Configurable lifetime | `RUNTIME_CPANEL_SESSION_TTL` (default `24h`) — issue short-lived cookies for tighter control |
| Authorization on the runtime | Frontend only hides UI; backend validates every request via the `ApiKeyStore` (cookie/header alike) |
| Cpanel isolated from `plugin-authn` end-to-end | `publicRoutes: { GET: ["/**"] }` keeps the SPA bundle reachable; the SPA itself enforces the API-key gate client-side |
| Plugin endpoints still protected | `plugin-authn` continues to protect plugin endpoints and plugin UI hosts (the iframes are separate origins) |

## File-browser — two upload paths, two contracts

The Workers/Plugins tabs expose **two distinct upload mechanisms** that hit
different runtime endpoints and follow different rules. Knowing which one you
are using matters because they validate paths differently.

### Path-agnostic install — `<UploadArchiveButton>`

The explicit "Upload" button in the tab header sends the archive to
`POST /api/{workers,plugins}/upload`. The server reads `manifest.yaml` /
`package.json` from the archive and places the contents at the **policy-derived
install path**, ignoring the FileBrowser's current path. So uploading while
browsing inside `@scope/foo/1.0.0/` (workers) or `@scope/foo/` (plugins) lands
the new install at the right semver/plugin folder regardless of where you are
in the tree.

Layout rules and full archive contract: see
[Runtime API reference — workers upload](./runtime-api-reference.md#post-apiworkersupload).
Scoped names work end-to-end on this path.

### Drag-drop into the current folder — `/api/{workers,plugins}/files/upload`

Dropping files onto a folder in the FileBrowser (or using the "Upload here"
context action) hits a different endpoint that **respects the current path**
and is gated by a `PathPolicy` (`workersPathPolicy` or `pluginsPathPolicy` in
`apps/runtime/src/libs/fs/path-policies.ts`).

Both policies are **scope-aware**. If the first segment starts with `@`, the
next segment is treated as the second half of the unit name — `@scope/name`
is recognised as one unit, not two folders:

| Path                            | Workers policy              | Plugins policy             |
|---------------------------------|------------------------------|-----------------------------|
| `@scope/`                       | rejected (no name yet)       | rejected (not a plugin yet) |
| `my-worker/1.0.0/`              | unit root (writes allowed)   | n/a                         |
| `my-worker/1.0.0/src/`          | inside unit (writes allowed) | n/a                         |
| `@scope/my-worker/1.0.0/`       | unit root (writes allowed)   | n/a                         |
| `@scope/my-worker/1.0.0/src/`   | inside unit (writes allowed) | n/a                         |
| `@scope/my-worker@1.0.0/`       | unit root, flat variant      | n/a                         |
| `my-plugin/`                    | n/a                          | unit root                   |
| `@scope/my-plugin/`             | n/a                          | unit root                   |
| `@scope/my-plugin/dist/x.js`    | n/a                          | inside unit (writes allowed) |

Drag-drop and the explicit Upload button both work for scoped names. The
`@scope` folder alone (no name segment) is treated as an "above any unit"
location: writes are rejected; navigation is fine.

## Cross-references

- Core API consumed by the cpanel: [Runtime API reference](./runtime-api-reference.md)
- Authentication that protects other apps and plugin endpoints: [`plugin-authn`](./plugin-authn.md)
- File-browser surface used by Workers + Plugins tabs: `apps/cpanel/src/components/file-browser/` (in-tree; replaces the retired `plugin-deployments`)
- Plugin UI hosting model via iframe: [Micro-frontend](./micro-frontend.md)
