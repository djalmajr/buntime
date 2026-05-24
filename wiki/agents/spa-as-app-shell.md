---
title: "Recipe — adapting a client SPA to a Buntime app-shell worker"
audience: agents
sources:
  - plugins/plugin-gateway/plugin.ts
  - apps/runtime/src/libs/registry/packager.ts
updated: 2026-05-24
tags: [agents, app-shell, spa, gateway, window-config, sharedworker, tailwind, recipe]
status: stable
---

# Recipe — adapting a client SPA to a Buntime app-shell worker

Concrete patterns for taking a client-only SPA (originally Vite/nginx/UnoCSS) and
running it as a Buntime **gateway app-shell** worker. Distilled from porting
`example-org/edge-functions/example-spa`. Apply these when "the SPA renders locally
but breaks as a Buntime worker".

## 1. Assets must live at single-segment paths

The gateway routes a request to the shell worker only when
`isDocument || (isRootPath && !isFrameEmbedding)`, where `isRootPath` means a
**single** path segment (`!pathname.slice(1).includes("/")`). See
[`plugin-gateway` → Request type detection](../apps/plugin-gateway.md#request-type-detection).

- Bun's HTML bundler emits flat root assets (`/chunk-abc.js`) → served fine.
- A multi-segment asset (`/assets/x.js`, `/workers/x.js`) is **never** handed to
  the shell worker → 404 (or mis-routed if a proxy rule matches the prefix).
- **Fix:** emit such assets to the dist **root**. Example: a SharedWorker built to
  `/workers/session.worker.js` failed; emitting it to `/session.worker.js` fixed it.

## 2. Per-environment config via `window.__config` (not the build)

Don't bake env-specific config (Keycloak realm/url, API bases) into the bundle —
the same artifact runs in multiple environments. Make the SPA a **serverless
worker** (`entrypoint: index.ts`) that injects config server-side:

```ts
// index.ts — serves dist/ and injects window.__config into the HTML <head>
const AUTH = Bun.env.AUTH_CONFIG ? JSON.parse(Bun.env.AUTH_CONFIG) : undefined; // per-env manifest value
// else fall back to fetching CONFIG_API/config/keycloak (open in-cluster endpoint)
const injected = `<script>window.__config=${JSON.stringify({ auth })}</script>`;
html.replace("</head>", injected + "</head>");
```

- Prod reads `window.__config`. Keep `PUBLIC_AUTH_CONFIG` (→ `window.__env__`) as a
  **DEV-only** fallback.
- `AUTH_CONFIG` (manifest env, server-only) is the simplest source when the
  backend config endpoint is gated (e.g. Kong 401 on `/api/config/keycloak`).
- Single-segment asset rule (1) still applies — the worker serves `dist/` files,
  so flat chunks "just work"; nested ones don't.

## 3. Bundle web/shared workers separately, reference a single-segment URL

`new SharedWorker(new URL("../workers/x.ts", import.meta.url))` does **not** get
bundled by an HTML-entrypoint build, and resolves to an unserved path. Add a
second `Bun.build` for the worker, emit to dist root, and reference the served URL:

```ts
// build: Bun.build({ entrypoints: ["./src/workers/session.worker.ts"], naming: "[name].[ext]", outdir })
new SharedWorker("/session.worker.js", { type: "module" });
```

## 4. UnoCSS → Tailwind class gaps (silent no-ops)

A UnoCSS SPA ported to Bun's `bun-plugin-tailwind` loses classes Tailwind doesn't
define — they vanish with no error:

| UnoCSS (works) | Tailwind (no-op) | Fix |
|----------------|------------------|-----|
| `font-600`, `font-300` | not generated | `font-semibold`, `font-light` |
| `max-w-none` + HTML `height="24"` | preflight `img{height:auto}` overrides the attr; `max-w-none` drops the clamp → **intrinsic size** | size in CSS: `max-h-6 max-w-full object-contain` |

Grep the source for `font-\d00` and bare HTML `height=`/`width=` on `<img>` when a
logo/icon renders huge or unstyled. Verify a class survived with
`grep font-semibold dist/*.css` after building.

## 5. Defensive rendering of backend-driven data

Backend data may not match the SPA's old assumptions. Guard before calling:

```tsx
// app.icon may be undefined → calling it throws "icon is not a function",
// which the router error boundary renders as a generic "unknown app" page.
typeof icon === "function" ? icon({...}) : <img src={typeof icon === "string" ? icon : fallback} />
```

When migrating an expand/collapse tree off a CSS-`checkbox` mechanism to React
state, port the **search-expand** too: force groups open while a query is present
(`const isOpen = query.trim() ? true : expanded`) — otherwise search filters but
leaves branches collapsed.

## Packaging + deploy

Package `dist/ + index.ts + manifest.yaml` as a `.tgz` (top dir `package/`) and
upload via `POST /_/api/workers/upload`. CI pipeline + gotchas:
[`runbook-gitlab-ci-worker-packages.md`](../ops/runbook-gitlab-ci-worker-packages.md).
