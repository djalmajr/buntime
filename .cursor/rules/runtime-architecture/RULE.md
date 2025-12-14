---
description: "Buntime runtime architecture - server/client structure, routes, base path injection"
alwaysApply: false
---

# Buntime Runtime Architecture

Worker pool runtime for Bun applications with integrated admin dashboard.

## Quick Reference

| Item | Value |
|------|-------|
| Location | `runtime/` |
| Entry | `index.ts` (unified) |
| Server Framework | Hono |
| Client Framework | React 19 + TanStack Router |
| Server Alias | `@/` → `./server/` |
| Client Alias | `~/` → `./client/` |

## Key Files

### Server (`runtime/server/`)

| File | Purpose |
|------|---------|
| `server/index.ts` | Bun.serve entry point |
| `server/api.ts` | Hono app (routes aggregator) |
| `server/app.ts` | Request resolution, plugin apps |
| `server/libs/pool/pool.ts` | WorkerPool class |
| `server/libs/pool/wrapper.ts` | Worker thread code, base injection |
| `server/plugins/loader.ts` | Plugin loader |
| `server/plugins/registry.ts` | Plugin registry |

### Client (`runtime/client/`)

| File | Purpose |
|------|---------|
| `client/index.html` | HTML with `<base href>` |
| `client/index.tsx` | React entry, reads base tag |
| `client/routes/__root.tsx` | Root layout |
| `client/helpers/api-client.ts` | Hono RPC client |
| `client/components/icon.tsx` | Icon component |

## Routes

- `/api/*` - Plugin API routes (e.g., `/api/keyval/*`, `/api/metrics/*`)
- `/:app/*` - Worker routes

## Base Path Injection

The runner injects `<base href>` into HTML responses for SPAs under subpaths:

1. Proxy rules set `base` option: `{ "base": "/cpanel" }`
2. Runner sets `x-base` header on requests
3. `wrapper.ts` injects `<base href="${base}/">` into HTML
4. Client reads base tag for router basepath

## Scripts

```bash
bun dev          # Watch mode
bun build        # Build runtime
bun build:bin    # Compile to binary
```

## Config Files

- `buntime.jsonc` - Runner plugins config
- `bunfig.toml` - Bun plugins (i18next, iconify, tsr, tailwind)
- `worker.jsonc` - Per-app worker config
- `tsconfig.json` - TypeScript config with path aliases

## Common Patterns

### Icons

```tsx
<Icon icon="lucide:search" className="size-4" />
```

### API Calls

```typescript
const res = await api._.deployments.list.$get({ query: { path } });
```

### Route Components

Files in `-components/` folders are NOT routes.

