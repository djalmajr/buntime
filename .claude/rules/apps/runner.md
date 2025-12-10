# Buntime Runner

Worker pool runtime for Bun applications. See [README](../../../apps/runner/README.md) for full documentation.

## Quick Reference

| Item | Value |
|------|-------|
| Location | `apps/runner/` |
| Entry | `src/index.ts` |
| Framework | Hono |
| Alias | `@buntime/runner/*` → `./src/*` |

## Key Files

| File | Purpose |
|------|---------|
| `src/libs/pool/pool.ts` | WorkerPool class |
| `src/libs/pool/wrapper.ts` | Worker thread code |
| `src/plugins/loader.ts` | Extension loader |
| `src/plugins/registry.ts` | Extension registry |
| `src/routes/worker.ts` | App routing |

## Scripts

```bash
bun dev          # Watch mode
bun build        # Build
bun build:bin    # Compile to binary
```

## Routes

- `/_/*` - Internal routes
- `/_/{ext}/*` - Extension routes
- `/:app/*` - Worker routes

## Config Files

- `buntime.jsonc` - Runner extensions config
- `worker.jsonc` - Per-app worker config

## Development Services

libSQL server runs via Docker Compose on port 8880:

```bash
docker compose up -d libsql   # Start libSQL server
docker compose logs libsql    # View logs
```

The `buntime.jsonc` uses `http://localhost:8880` for the KeyVal plugin.
