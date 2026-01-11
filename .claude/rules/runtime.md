# Buntime Runtime

Worker pool runtime for Bun applications with integrated admin dashboard. See [README](../../runtime/README.adoc) for full documentation.

## Quick Reference

| Item | Value |
|------|-------|
| Location | `runtime/` |
| Entry | `src/index.ts` |
| Server Framework | Hono |
| Server Alias | `@/` → `./src/` |

## Key Files

### Server (`runtime/src/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Bun.serve entry point |
| `src/api.ts` | Hono app (routes aggregator) |
| `src/app.ts` | Request resolution, plugin apps |
| `src/libs/pool/pool.ts` | WorkerPool class |
| `src/libs/pool/wrapper.ts` | Worker thread code, base injection |
| `src/plugins/loader.ts` | Plugin loader |
| `src/plugins/registry.ts` | Plugin registry |
| `src/routes/plugins-info.ts` | Plugin info API routes |
| `src/routes/worker.ts` | Worker app routes |

## Routes

- `/api/plugins/*` - Plugin info API routes
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
bun build:types  # Build TypeScript types
bun build:bin    # Compile to binary
```

## Configuration

Runtime is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_DIRS` | **Required** | App directories (JSON array or comma-separated) |
| `PLUGIN_DIRS` | `["./plugins"]` | Plugin directories |
| `POOL_SIZE` | `100` | Max concurrent workers |
| `PORT` | `8000` | Server port |
| `LOG_LEVEL` | `info` | Log level |

## Config Files

- `plugins/*/manifest.jsonc` - Plugin manifest (metadata + config)
- `apps/*/manifest.jsonc` - Per-worker config (entrypoint, maxBodySize)
- `tsconfig.json` - TypeScript config with path aliases

## Plugin Auto-Discovery

Plugins are auto-discovered from `PLUGIN_DIRS`. Each plugin has its own `manifest.jsonc`:

```jsonc
// plugins/plugin-keyval/manifest.jsonc
{
  "name": "@buntime/plugin-keyval",
  "enabled": true,
  "base": "/keyval",
  "entrypoint": "dist/client/index.html",
  "dependencies": ["@buntime/plugin-database"]
}
```

## Development Services

libSQL server runs via Docker Compose on port 8880:

```bash
docker compose up -d libsql   # Start libSQL server
docker compose logs libsql    # View logs
```
