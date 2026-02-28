---
name: dev-setup
summary: |
  - Local dev: `bun dev` at root (runs runtime + plugins + cpanel in parallel)
  - .env at root configures RUNTIME_PLUGIN_DIRS, RUNTIME_WORKER_DIRS, GATEWAY_SHELL_DIR
  - External plugins: run `bun dev` for watch mode, or `bun run build` for one-off build
  - RUNTIME_WORKER_DIRS points to PARENT directories containing apps, not individual apps
  - RUNTIME_PLUGIN_DIRS points to directories containing plugins with manifest.yaml
  - Multiple paths separator is `:` (PATH style), never `,`
---

# Development Setup

## Starting Local Environment

```bash
# At buntime root
bun dev
```

This runs in parallel:
- `@buntime/plugin-*` in watch mode (core plugins)
- `@buntime/cpanel` in watch mode
- `@buntime/runtime` in dev mode

## .env File

The `.env` at buntime root configures the local environment:

```bash
# runtime — directories that CONTAIN apps and plugins
RUNTIME_PLUGIN_DIRS=/path/to/external-plugins
RUNTIME_WORKER_DIRS=/path/to/buntime/apps:/path/to/edge-functions

# plugin-gateway
GATEWAY_SHELL_DIR=/path/to/functions/app-shell
GATEWAY_SHELL_EXCLUDES=cpanel
```

**RUNTIME_WORKER_DIRS** must point to **parent directories** that contain apps, not individual apps. Each subdirectory is discovered as a separate app.

**RUNTIME_PLUGIN_DIRS** points to directories containing plugins. Each subdirectory with `manifest.yaml` is loaded as a plugin.

## External Plugins

External plugins live outside the buntime monorepo and are loaded via `RUNTIME_PLUGIN_DIRS`.

All external plugins support watch mode (`bun dev`), which rebuilds `dist/plugin.js` on source changes. Run each plugin in a separate terminal alongside `bun dev` at buntime root:

```bash
# Terminal 1 — buntime runtime
cd /path/to/buntime && bun dev

# Terminal 2 — external plugin (watch mode)
cd /path/to/external-plugins/plugin-name && bun dev

# Terminal 3 — another external plugin (watch mode)
cd /path/to/external-plugins/another-plugin && bun dev
```

For a one-off build without watch:

```bash
cd /path/to/external-plugins/plugin-name
bun run build
```

The generated `dist/plugin.js` is what the runtime loads via `pluginEntry` from `manifest.yaml`.

> **Note:** The runtime does NOT hot-reload external plugins automatically when `dist/plugin.js` changes. A restart is required to pick up new builds.

## Notes

- Multiple paths separator is `:` (PATH style), never `,`
- `FRONT_MANAGER_API` is required for `plugin-resource-tenant` (fatal error if missing)
- External plugins without `dist/plugin.js` are silently ignored
