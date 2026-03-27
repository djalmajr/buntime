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

`bun --hot src/index.ts` restarts the runtime on file changes. Plugins rebuild in parallel during hot reload.

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
