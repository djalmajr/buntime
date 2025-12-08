# CPanel

React admin dashboard for Buntime. See [README](../../../apps/cpanel/README.md) for full documentation.

## Quick Reference

| Item | Value |
|------|-------|
| Location | `apps/cpanel/` |
| Entry | `src/index.tsx` |
| Framework | React 19 + TanStack Router |
| Alias | `~/` → `./src/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/routes/__root.tsx` | Root layout |
| `src/helpers/api-client.ts` | Hono RPC client |
| `src/components/icon.tsx` | Icon component |
| `bunfig.toml` | Bun plugins config |

## Scripts

```bash
bun dev          # Dev server with HMR
bun build        # Production build
```

## Routes

| Route | File |
|-------|------|
| `/` | `routes/index.tsx` |
| `/deployments` | `routes/deployments/index.tsx` |
| `/redirects` | `routes/redirects/index.tsx` |

## Patterns

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
