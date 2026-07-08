**CRITICAL**: These instructions are MANDATORY. Read all *.md files in `~/.agents/rules` to obtain user-level context. This file is the **single source of truth for agent execution rules in this repo** — `.agents/rules/` does not exist; everything an agent needs to know about *how to act* lives here.

<!-- ai-memory:start -->
## Long-term memory (ai-memory)

This project uses [ai-memory](https://github.com/akitaonrails/ai-memory)
for cross-session continuity.

**Default to the current project - always.** Every ai-memory tool
auto-scopes to the project resolved from your session's working
directory. **Do NOT pass `project`, `workspace`, or `cwd` arguments unless
the user explicitly references a *different* project by name** (e.g. "what
did we decide in the `other-app` project?"). Phrases like "this project",
"here", "we", "our work", and "where did we leave off" all mean the
*current* project, so call tools with no scoping args.

This default assumes the MCP client can identify the current agent
session. Static MCP clients in parallel sessions for the same user cannot
forward the real agent session id automatically; pass explicit
`workspace` + `project` / `scopes`, or use a session-aware bridge that
forwards the lifecycle-hook session id on MCP calls.

**Lifecycle hooks already capture every prompt and tool call
automatically.** Do not manually write routine notes. Only write durable
memory when the user explicitly asks to remember or annotate something
permanently.

### Use the installed ai-memory Agent Skills

Detailed tool-routing guidance lives in the installed ai-memory Agent
Skills. When a task matches an installed ai-memory Agent Skill, load and
follow that skill before calling ai-memory tools. The skills cover memory
retrieval, handoffs, durable pages, learning maintenance, and routing
install or refresh work.

### When you write a project rule, write it here

If you're about to write a durable project rule ("always X", "never
Y", "all PRs must ..."), write it in the project's canonical agent instruction file.
Many projects use CLAUDE.md for Claude Code and
AGENTS.md for Codex / OpenCode / Cursor / Gemini CLI, but if the project
says one file is canonical, use that file.

If the rule is a standing *user/team* preference that should apply to
every project (tech choices, code style, personal conventions), save it
to ai-memory's reserved global scope instead — the durable-pages skill
covers how. Default memory reads surface global-scope pages in every
project automatically.

### Refreshing this snippet

This block is maintained by ai-memory. Two ways to refresh it with the
latest binary's recommended copy:

- **From the agent** (no terminal needed): ask "refresh the ai-memory
  routing in this project". The agent calls `memory_install_self_routing`,
  picks the right filename for itself (Claude Code -> `CLAUDE.md`; Codex /
  OpenCode / Cursor / Gemini -> `AGENTS.md`), uses its Write / Edit tool
  to replace or append the returned `markered_block` while preserving
  non-ai-memory user content, then writes or updates each returned
  `managed_skills` item under the selected skill root from `target_hints`
  using its `relative_path`.
- **From the CLI**: `ai-memory install-instructions` (defaults to
  `CLAUDE.md`; pass `--target AGENTS.md` for non-Claude agents or projects
  that use `AGENTS.md` as the canonical instruction file).

Both are idempotent: re-runs replace the block bracketed by
`<!-- ai-memory:start -->` / `<!-- ai-memory:end -->` markers without
disturbing the rest of the file.
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
