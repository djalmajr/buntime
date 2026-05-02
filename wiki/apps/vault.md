---
title: "@buntime/vault (apps/vault)"
audience: dev
sources:
  - apps/vault/**
updated: 2026-05-02
tags: [vault, secrets, app]
status: draft
---

# @buntime/vault

> Credential/secrets backend for Buntime — **under active development** (confirmed 2026-05-02). The `apps/vault/` directory exists and has `node_modules` installed, but **no source code has been committed yet** — no `package.json`, `manifest.yaml`, README, `index.ts`, `app.ts`, or routes are present in the current tree. This page documents what can be confirmed today and explicitly marks the pending design items.

> [!IMPORTANT]
> This page is `draft`. The vault's capabilities, contracts, and deployment strategy **are not yet defined** in the repository. Do not infer features from this page — the implementation is still being designed.

## Current state in the repository

Contents present in `apps/vault/` (excluding `node_modules` and `dist`):

| Path | Size/content | Note |
|---|---|---|
| `apps/vault/.dirinfo` | 49 files / ~4 MB / updated 2026-03-15 | dirinfo metadata — suggests the tree once had sources; none remain |
| `apps/vault/client/` | Empty (only `.tanstack/tmp`) | Reserved for the frontend |
| `apps/vault/server/` | Only `.env` (`PGLITE_PATH=./pg_data`) and `pg_data/` | Reserved for the backend |
| `apps/vault/server/pg_data/` | PostgreSQL (PGlite) directory | Indicates there was local dev with embedded PGlite |
| `apps/vault/dist/` | Pre-compiled JS chunks | Leftover from a previous build; not source |

No `manifest.yaml`, `package.json`, README, or `.md` was found in the app.

## Inferred stack (with caution)

The `apps/vault/node_modules/` directory (present in the workspace) contains dependencies that hint at the intended stack when the app is resumed. This does not mean the current code implements any of these — only that they were installed at some point.

| Dependency | Likely role |
|---|---|
| `hono`, `hono-openapi` | Server HTTP framework with OpenAPI |
| `@scalar/*` | Scalar-style OpenAPI documentation |
| `drizzle-orm`, `drizzle-kit` | ORM and migrations |
| `postgres`, `@electric-sql/pglite` (via `@electric-sql`) | Real PostgreSQL or embedded PGlite |
| `react`, `react-dom` | Frontend SPA |
| `@tanstack/*` | Likely TanStack Router/Query on the client |
| `@radix-ui`, `tailwindcss`, `class-variance-authority`, `clsx`, `tw-animate-css` | Radix UI + Tailwind v4 |
| `vite`, `@vitejs/*` | Client bundler |
| `@opentelemetry/*` | Observability |
| `zod` | Validation |
| `sonner` | UI toasts |
| `@iconify-json/*`, `unplugin-icons`, `@svgr/*` | Icons and SVG-as-component |

The simultaneous presence of `client/` and `server/` together with Vite + Hono suggests the **full-stack app** pattern: Vite SPA served by a Hono backend. The `.env` points to PGlite (`PGLITE_PATH=./pg_data`), which matches local dev without an external Postgres instance.

## Projected structure

```text
apps/vault/
├── client/        # frontend SPA (currently empty)
├── server/        # Hono + Drizzle backend (currently empty)
│   ├── .env       # PGLITE_PATH=./pg_data
│   └── pg_data/   # PGlite storage
└── dist/          # legacy build (leftover)
```

## Position in the ecosystem

References found in other wiki pages:

| Page | How it references vault |
|---|---|
| `/CLAUDE.md` (workspace policy) | `apps/vault/` listed implicitly via "minimal package READMEs" path — no contractual description |
| `wiki/index.md` | `@buntime/vault` row — "vault backend (sparse documentation, nascent code; status pending confirmation)" |
| `wiki/README.md` (post-slim) | Pointer-only landing; vault not specifically described |

In other words, the **documented purpose** is a credential/secrets vault. The **implementation does not yet exist** on this branch — work is in progress and the contracts below are still being defined.

## What is **not** defined

Explicit open items to confirm before any dependent work:

| Topic | Status |
|---|---|
| App manifest (`manifest.yaml`) | Missing |
| Data model (Drizzle schemas) | Missing |
| HTTP API / REST/OpenAPI contracts | Missing |
| Encryption-at-rest strategy | Not documented |
| Access policy (interaction with `plugin-authn`/`plugin-authz`) | Not documented |
| Secret rotation and expiration policy | Not documented |
| Deployment format (Buntime app, plugin, or external service?) | Not defined |
| Production storage (PGlite dev only? External Postgres?) | Not defined |
| Frontend (management UI? micro-frontend hosted by CPanel?) | Not defined |

## Suggested next steps

1. **Decide the packaging format**: will vault be a Buntime app (with `manifest.yaml`) or a plugin? The choice determines whether it goes through the [`plugin-deployments`](./plugin-deployments.md) path or the standard app upload flow.
2. **Define the HTTP contract** (endpoints, auth model) and generate an `openapi.yaml` for the client to consume via Scalar.
3. **Specify the data model** with Drizzle migrations in `server/`.
4. **Document the encryption policy** (KEK/DEK, external KMS? envelope encryption?).
5. **Update this page** by replacing `status: draft` with `stable` and listing real `sources`.

## Cross-references

- Upload path if vault is deployed as an app/plugin: [`plugin-deployments`](./plugin-deployments.md)
- Auth/identity that will control vault access: [`plugin-authn`](./plugin-authn.md), [`plugin-authz`](./plugin-authz.md)
- Hosting model if the UI is served by CPanel: [Micro-frontend](./micro-frontend.md)
