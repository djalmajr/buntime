# Conventions

## Code Style

- Biome for lint and format (`bun biome check --write`)
- TypeScript strict mode
- Trailing commas everywhere
- No emojis in code or comments

## Naming

- Files: `kebab-case.ts`
- Interfaces/Types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Functions: `camelCase`

## Imports

- Path alias: `@/` maps to `./src/` (e.g., `@/config`, `@/constants`)
- Always include `.ts` extension in relative imports
- Use `@buntime/shared` for shared types and utilities (workspace package)
- Biome handles import sorting

## Testing

- Use `bun:test` (describe, it, expect, mock)
- Tests colocated with source: `*.test.ts` next to the file being tested
- `bun run lint` and `bun test` must pass before any commit

## Plugin Manifest

- Every plugin must have a `manifest.yaml` with at least `name` field
- `enabled: false` in manifest disables the plugin
- `pluginEntry` field specifies custom entry file (default: `plugin.ts` or `index.ts`)
- `dependencies` -- required plugins (plugin excluded if any missing)
- `optionalDependencies` -- plugins that should load first if available
- `base` -- route prefix (must match `/[a-zA-Z0-9_-]+`, cannot use reserved paths)
