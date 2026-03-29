# Development

## Commands

```bash
bun run dev          # Hot reload mode (bun --hot src/index.ts)
bun run build        # Production build
bun run build:bin    # Compile to standalone binary
bun run lint         # Biome check + TypeScript check
bun run test         # Run tests
bun test --coverage  # Run tests with coverage report
```

## Environment Variables

Set in `.env` in `apps/runtime/` (overrides root `.env`):

| Variable | Description |
|----------|-------------|
| `RUNTIME_PLUGIN_DIRS` | Colon-separated paths to plugin directories |
| `RUNTIME_WORKER_DIRS` | Colon-separated paths to worker directories |

## Hot Reload

Use `--watch` instead of `--hot` for the runtime dev script. `--hot` causes issues with timers/cron (croner doesn't fire) and creates zombie port bindings.

## Proxy Rules (KeyVal / SQLite)

Values in KeyVal (SQLite) must be stored as blob (`Uint8Array`), not string. If manually editing the DB, ensure the value type matches.

## PgBouncer (Dev)

PgBouncer with Bitnami image: `auth_type=scram-sha-256` with plaintext userlist does NOT work. The PgBouncer always sends SCRAM to the client regardless of `auth_type` setting. Use direct PostgreSQL connection for dev.

## Plugin Development

To develop a plugin alongside the runtime:

1. Place plugin in a directory listed in `RUNTIME_PLUGIN_DIRS`
2. Ensure the plugin has a `manifest.yaml` with `name` and `enabled: true`
3. The runtime scans for `plugin.ts` or `index.ts` (or custom `pluginEntry` from manifest)
4. Supports scoped packages: `@scope/plugin-name/`

## Plugin Directory Structures

```
pluginDirs/
  direct-plugin.ts              # Direct file plugin
  my-plugin/                    # Subdirectory plugin
    manifest.yaml
    plugin.ts
  @scope/                       # Scoped package
    my-plugin/
      manifest.yaml
      plugin.ts
```

## Lint & Errors

If `bun run lint` reports warnings or errors -- even in files you did not touch -- fix them. The codebase must always be left cleaner than you found it.
