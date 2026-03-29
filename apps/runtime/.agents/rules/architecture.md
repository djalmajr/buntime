# Architecture

## Entry Points

- `src/index.ts` -- Main entry. Starts the runtime with `bun --hot src/index.ts`.
- `src/app.ts` -- Hono app setup.
- `src/config.ts` -- Configuration loading (env vars, .env files).
- `src/constants.ts` -- Runtime constants (API_PATH, VERSION, RESERVED_PATHS).

## Key Modules

- `src/plugins/loader.ts` -- `PluginLoader` class. Scans plugin directories, topologically sorts by dependencies, loads plugins with resilience (failed plugin does not prevent others from loading).
- `src/plugins/registry.ts` -- `PluginRegistry`. Stores loaded plugins and their `provides()` exports. Other plugins access services via `ctx.getPlugin<T>(name)`.
- `src/routes/deployments.ts` -- Deployment management API.
- `src/routes/plugins.ts` -- Plugin management API.
- `src/routes/workers.ts` -- Worker management API.
- `src/libs/pool/` -- Worker pool management.
- `src/libs/registry/` -- Worker registry.

## Plugin Loading

1. `PluginLoader.load()` scans `pluginDirs` for directories with `manifest.yaml`
2. Plugins are sorted topologically using Kahn's algorithm based on `dependencies` and `optionalDependencies`
3. For each plugin in sorted order:
   a. Check if required dependencies loaded successfully (skip if any failed)
   b. Import module lazily (disabled plugins are never imported)
   c. Call `onInit(ctx)` with timeout (30s)
   d. Call `provides()` after `onInit()` completes -- before next plugin loads
   e. Register plugin in registry
4. Failed plugins are tracked; their dependents are skipped with warnings

## Plugin Load Order

- Load order matters: topological sort based on dependencies
- `provides()` is called after `onInit()` for each plugin before the next plugin loads
- This ensures dependent plugins can access services from their dependencies via `ctx.getPlugin()`

## Worker Routes

- If no resolved app for a request, return 404 (not crash)
- Workers export `{ routes, fetch, onTerminate }` interface

## Configuration

- `.env` in `apps/runtime/` overrides root `.env`
- `RUNTIME_PLUGIN_DIRS` -- colon-separated paths to plugin directories
- `RUNTIME_WORKER_DIRS` -- colon-separated paths to worker directories

## Plugin Resilience

- Plugin loader must be resilient -- a failed plugin must not prevent others from loading
- Failed plugins are tracked and their dependents are skipped with warnings
- Circular dependencies are detected and those plugins are excluded (not crash)
- Missing required dependencies cause the plugin and its dependents to be excluded
- Each plugin's `onInit` has a 30-second timeout

## Worker Route Fallback

If no worker app is resolved for a request path, the runtime returns 404 instead of crashing.

## `readAppEnv`

`readAppEnv` in `@buntime/shared/utils/buntime-config` merges `.env` file over `manifest.yaml` env section (higher priority). Used by plugin-migrations and plugin-resource-tenant.
