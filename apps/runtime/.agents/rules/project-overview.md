# Project Overview

**Buntime Runtime** is the core runtime that orchestrates plugins and workers. It loads plugins from configured directories, manages worker lifecycle, and provides an API for deployments and management.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Hono (API + OpenAPI docs via `hono-openapi`)
- **Database**: libSQL (`@libsql/client`)
- **Utilities**: `es-toolkit`, `quick-lru`, `semver`
- **Validation**: Zod v4
- **API Docs**: Scalar (`@scalar/hono-api-reference`)
- **Plugin Framework**: `@buntime/shared` (workspace package)
- **Lint/Format**: Biome
- **Tests**: Bun test runner

## Key Features

- **Plugin system**: auto-discovery, topological sort based on dependencies, resilient loading
- **Worker management**: Web Workers for running edge function apps
- **Hot reload**: `--hot` flag restarts runtime, plugins rebuild in parallel
- **API**: REST API for deployments, plugins, and workers management
- **Multi-directory**: supports multiple plugin and worker directories (colon-separated)
