# Buntime Server

Worker pool runtime for Bun applications. See [README](../../../apps/server/README.md) for full documentation.

## Quick Reference

| Item | Value |
|------|-------|
| Location | `apps/server/` |
| Entry | `src/index.ts` |
| Framework | Hono |
| Alias | `@buntime/server/*` → `./src/*` |

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

- `buntime.jsonc` - Server extensions config
- `worker.jsonc` - Per-app worker config
