**CRITICAL**: These instructions are MANDATORY. Read all *.md files in `~/.agents/rules` to obtain user-level context. This file is the **single source of truth for agent execution rules in this repo** — `.agents/rules/` does not exist; everything an agent needs to know about *how to act* lives here.

<!-- ai-memory:start -->
## LLM Memory (ai-memory)

Before answering or acting on durable project knowledge, recall from the ai-memory MCP
(server `memory-personal`, workspace `zommehq`, project `buntime`).

1. Read the project's agent rules.
2. `memory_query` (semantic recall) via the ai-memory MCP, for the relevant workspace/project.
3. Read the page markdown directly (or `/api/v1`) when the target path is known.
4. If a task discovers a canonical rule, gotcha, schema/contract, operational constraint, or
   product decision, persist it via `memory_write_page` and link related pages with `[[path.md]]`.

Semantic decisions from conversation and debugging belong to the agent — recall before acting,
write back when you learn something canonical.
<!-- ai-memory:end -->

## Agent execution rules

The following rules condition agent action and must be followed without lookup. Knowledge (the *what* and *why*) is in the wiki; the rules below are the *do/don't*.

### Release & publishing

- **NEVER** run `bump-version.ts`, `git tag`, or `git push` without **explicit user permission**.
- Every new version **MUST** have its own entry in `charts/release-notes.md` **before** publishing — release notes describe what changed in *that specific version*, not a cumulative changelog.
- Always show the user the exact commands that will be executed and **wait for confirmation** before any release operation.
- **Never publish `@buntime/shared` manually from CLI** — only via the GitHub Actions OIDC workflow (`gh workflow run jsr-publish.yml`). Full flow: ai-memory page `wiki/ops/jsr-publish.md`.
- `packages/shared/jsr.json:version` and `packages/shared/package.json:version` **must always match** — update both together.

### Testing

- **Always run `bun test` before reporting a task complete.** No exceptions.
- Test files live alongside source files as `*.test.ts` (colocated, not in a separate `__tests__/` directory).
- Use `bun:test` (`describe`, `it`, `expect`, `mock`, `spyOn`). The framework is Jest-compatible.
- For plugin changes, write tests covering the new behavior. Concrete patterns (`WorkerPool` mock, `PluginContext` mock, Hono `app.fetch` testing, temp-dir setup, plugin lifecycle test, anti-patterns): ai-memory page `wiki/agents/testing-patterns.md`. Reading existing `plugin.test.ts` files in the same workspace is also a fast way to absorb the conventions.

### Code style & conventions

- Biome handles lint and format. Run `bun run lint` (lint + typecheck) before committing — `bun run lint` and `bun test` **must both pass** before any commit.
- TypeScript **strict mode** is mandatory.
- Trailing commas everywhere.
- **No emojis** in code, comments, or commit messages.
- Naming:
  - Files: `kebab-case.ts`
  - Types/Interfaces: `PascalCase`
  - Constants: `UPPER_SNAKE_CASE`
  - Functions: `camelCase`
- Imports:
  - Path alias `@/` maps to `./src/` (per workspace).
  - Always include the `.ts` extension in relative imports.
  - Use `@buntime/shared` (workspace package) for shared types and utilities — don't duplicate.

### Plugin development

- **Choose ONE API mode per plugin: persistent OR serverless.** Don't duplicate API in both `plugin.ts` and `index.ts`. Reference: ai-memory page `wiki/apps/plugin-system.md`.
- Plugin `base` path **must match** `/[a-zA-Z0-9_-]+` (single segment) and **cannot be a reserved path** (`/api`, `/health`, `/.well-known`). The loader will reject invalid bases.
- **Always write tests** for plugin changes (`plugin.test.ts` next to `plugin.ts`).
- Multiple paths in env vars use `:` (PATH style), **never `,`** — applies to `RUNTIME_PLUGIN_DIRS`, `RUNTIME_WORKER_DIRS`.

### Error handling

- **Always use specific error classes** from `@buntime/shared/errors` (`ValidationError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, etc.) — never throw a generic `Error` for application errors.
- **Always include an error code** in `SCREAMING_SNAKE_CASE` for client-side handling: `throw new ValidationError("Email is required", "MISSING_EMAIL")`.
- **Log full error details server-side** with context (`requestId`, `userId`, stack trace) — but keep the message returned to the client user-friendly.

### Development discipline

- **If `bun run lint` reports warnings or errors — even in files you did not touch — fix them.** The codebase must be left cleaner than you found it.
- For runtime dev, use `bun --watch` (not `bun --hot`) — `--hot` breaks timers/cron (croner doesn't fire) and leaks zombie port bindings.

## Language

Wiki content is in **en-US**. The project may have international audience and contributors. This `CLAUDE.md`, `AGENTS.md`, and the `wiki/` directory are all in English. Personal user rules in `~/.agents/rules/` may remain in their original language.
