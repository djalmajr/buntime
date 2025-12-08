# CPanel

React-based admin dashboard for managing Buntime worker pool deployments.

## Features

- **Dashboard** - Real-time pool metrics, worker list, charts
- **Deployments** - File browser, upload, rename, delete
- **Redirects** - Proxy rules CRUD with regex
- **i18n** - English and Portuguese

## Tech Stack

Bun, React 19, TanStack (Router, Query, Table), Tailwind v4, Radix UI, shadcn/ui, i18next, Recharts

## Project Structure

```
apps/cpanel/
├── index.ts              # Production entry
├── index.dev.ts          # Dev entry with HMR
├── bunfig.toml           # Bun config
├── scripts/
│   ├── build.ts          # Build script
│   └── preload.ts        # TSR preload
└── src/
    ├── index.html
    ├── index.tsx
    ├── index.css
    ├── components/
    │   ├── icon.tsx      # Icon component
    │   ├── navigation/
    │   └── ui/           # shadcn/ui
    ├── contexts/
    ├── helpers/
    │   ├── api-client.ts # Hono RPC
    │   ├── i18n.ts
    │   └── query-client.ts
    ├── hooks/
    ├── routes/           # File-based routing
    │   ├── __root.tsx
    │   ├── index.tsx
    │   ├── deployments/
    │   └── redirects/
    └── locales/
```

## Routes

| Route | Description |
|-------|-------------|
| `/` | Dashboard |
| `/deployments` | File browser |
| `/redirects` | Proxy rules |

## API Proxy

```typescript
routes: {
  "/_/*": proxyTo(BUNTIME_API),  // Backend
  "/*": client,                   // React SPA
}
```

## Scripts

```bash
bun dev          # Dev server with HMR
bun build        # Production build
bun lint         # Format + type check
```

## Path Aliases

`~/` → `./src/`

```typescript
import { Button } from "~/components/ui/button";
import { api } from "~/helpers/api-client";
```

## Key Patterns

### Icon Component

```tsx
import { Icon } from "~/components/icon";

<Icon icon="lucide:search" className="size-4" />
```

### API Client

```typescript
import { api } from "~/helpers/api-client";

const res = await api._.deployments.list.$get({ query: { path } });
```

### Routing

Files in `-components/` are NOT routes.

| File | Route |
|------|-------|
| `routes/__root.tsx` | Root layout |
| `routes/index.tsx` | `/` |
| `routes/deployments/index.tsx` | `/deployments` |
| `routes/redirects/index.tsx` | `/redirects` |
