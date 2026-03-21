---
name: monorepo
summary: |
  - Bun workspaces: apps/*, packages/*, plugins/*
  - Shared code: @buntime/shared (packages/shared)
  - Import alias: @/ for apps/runtime/src
  - Scripts: bun test, bun build, bun dev (all workspaces)
  - Dependencies between workspaces via package.json
  - Each workspace has own package.json, tsconfig.json
---

# Monorepo Structure

## Overview

Buntime uses Bun workspaces for a monorepo structure.

```
buntime/
├── package.json          # Root: workspaces config, shared scripts
├── bun.lock              # Single lockfile for all workspaces
├── apps/                 # Applications
│   └── runtime/          # Main runtime
├── packages/             # Shared libraries
│   ├── shared/           # @buntime/shared
│   └── keyval/           # @buntime/keyval
└── plugins/              # Core plugins
    ├── plugin-database/  # @buntime/plugin-database
    ├── plugin-gateway/   # @buntime/plugin-gateway
    └── ...
```

## Workspace Configuration

**Root package.json:**
```json
{
  "name": "buntime",
  "workspaces": [
    "apps/*",
    "packages/*",
    "plugins/*"
  ],
  "scripts": {
    "build": "bun run --filter '*' build",
    "dev": "bun run --filter '*' dev",
    "test": "bun run --filter '*' test",
    "lint": "bun run --filter '*' lint"
  }
}
```

## Workspaces

### apps/runtime

Main runtime application.

```json
{
  "name": "@buntime/runtime",
  "dependencies": {
    "@buntime/shared": "workspace:*"
  }
}
```

**Import alias:** `@/` → `apps/runtime/src/`

```typescript
// In apps/runtime/src/app.ts
import { logger } from "@/libs/logger";  // → apps/runtime/src/libs/logger
import { Headers } from "@/constants";    // → apps/runtime/src/constants
```

### packages/shared

Shared utilities and types.

```json
{
  "name": "@buntime/shared",
  "exports": {
    "./types": "./src/types/index.ts",
    "./utils/*": "./src/utils/*.ts",
    "./logger": "./src/logger/index.ts"
  }
}
```

**Usage:**
```typescript
import type { BuntimePlugin } from "@buntime/shared/types";
import { splitList } from "@buntime/shared/utils/string";
import { createLogger } from "@buntime/shared/logger";
```

### plugins/*

Core plugins (built into image).

```json
{
  "name": "@buntime/plugin-database",
  "dependencies": {
    "@buntime/shared": "workspace:*"
  }
}
```

## Scripts

### Root Level (all workspaces)

```bash
# Run all tests
bun test

# Build all
bun build

# Dev mode (parallel)
bun dev

# Lint all
bun lint
```

### Filtered (specific workspace)

```bash
# Run only runtime tests
bun run --filter @buntime/runtime test

# Build only plugins
bun run --filter '@buntime/plugin-*' build

# Dev mode for specific package
bun run --filter @buntime/shared dev
```

### Workspace-specific

```bash
# Run from workspace directory
cd apps/runtime
bun test
bun build
```

## Adding a New Workspace

### New Package

```bash
mkdir -p packages/my-package
cd packages/my-package

# Create package.json
cat > package.json << 'EOF'
{
  "name": "@buntime/my-package",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "bun build src/index.ts --outdir dist",
    "test": "bun test"
  }
}
EOF

# Create source
mkdir src
echo 'export const hello = "world";' > src/index.ts
```

### New Plugin

```bash
mkdir -p plugins/plugin-my-feature
cd plugins/plugin-my-feature

# Create package.json
cat > package.json << 'EOF'
{
  "name": "@buntime/plugin-my-feature",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@buntime/shared": "workspace:*"
  },
  "scripts": {
    "build": "bun build plugin.ts --outdir dist",
    "test": "bun test"
  }
}
EOF

# Create manifest
cat > manifest.yaml << 'EOF'
name: "@buntime/plugin-my-feature"
base: "/my-feature"
enabled: true
pluginEntry: dist/plugin.js
EOF

# Create plugin
echo 'export default () => ({ onInit() { console.log("init"); } });' > plugin.ts
```

## Dependencies Between Workspaces

Use `workspace:*` for internal dependencies:

```json
{
  "dependencies": {
    "@buntime/shared": "workspace:*",
    "@buntime/keyval": "workspace:*"
  }
}
```

Bun resolves these to local paths automatically.

## TypeScript Configuration

Each workspace has its own `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

## Common Patterns

### Importing from Shared

```typescript
// Types
import type { PluginImpl, PluginContext } from "@buntime/shared/types";

// Utilities
import { splitList, joinList } from "@buntime/shared/utils/string";
import { parseSize } from "@buntime/shared/utils/size";
import { parseDuration } from "@buntime/shared/utils/duration";

// Logger
import { createLogger } from "@buntime/shared/logger";

// Errors
import { ValidationError, NotFoundError } from "@buntime/shared/errors";
```

### Plugin Dependencies

Plugins can depend on other plugins via manifest:

```yaml
# manifest.yaml
dependencies:
  - "@buntime/plugin-database"    # Required
optionalDependencies:
  - "@buntime/plugin-proxy"       # Optional
```

## Build Order

Bun handles dependency order automatically. For manual builds:

1. `packages/shared` (no deps)
2. `packages/keyval` (depends on shared)
3. `plugins/*` (depend on shared, keyval)
4. `apps/runtime` (depends on all)

## Troubleshooting

### "Cannot find module"

```bash
# Reinstall all deps
rm -rf node_modules bun.lock
bun install
```

### Type errors in workspace imports

```bash
# Rebuild the dependency
cd packages/shared
bun build

# Or rebuild all
bun run build
```

### Circular dependencies

Avoid circular imports between workspaces. Use:
- Types in `@buntime/shared/types`
- Utilities in `@buntime/shared/utils/*`
- Keep plugins independent
