**CRITICAL**: These instructions are MANDATORY. Read all *.md files in `~/.agents/rules` to obtain user-level context. This file is the **single source of truth for agent execution rules in this repo** — `.agents/rules/` does not exist; everything an agent needs to know about *how to act* lives here, and everything an agent needs to know about *the project* lives in [`wiki/`](./wiki/).

## Wiki (`wiki/`)

The canonical Buntime documentation lives in [`wiki/`](./wiki/). It is an LLM-Maintained Wiki in the [Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern, with a navigable index, standardized frontmatter, and named operations (`wiki-ingest`, `wiki-query`, `wiki-lint`).

**Always consult the wiki first** (via the `qmd` MCP or `qmd --index buntime query "..."`) before answering questions about architecture, plugins, deploy, performance, or data.

Entry points:

1. [`wiki/index.md`](./wiki/index.md) — navigable catalog (by audience, topic, source).
2. [`wiki/CONVENTIONS.md`](./wiki/CONVENTIONS.md) — schema, frontmatter, operations.
3. [`wiki/log.md`](./wiki/log.md) — ingest/query/lint history (most recent first).

Do not re-synthesize from code or scattered docs when the answer already exists in the wiki — search first, update after, log the action.

### Capture relevant findings as you work — actively, not on request

Treat the wiki as a write-as-you-go system. **Whenever you uncover information that future-you (or another agent) would benefit from finding via search, document it.** Do not wait for the user to ask. Concrete triggers — if any of these happens during a task, the wiki gets an update *in the same conversation*:

- A non-obvious gotcha, workaround, or pitfall (e.g. "PgBouncer SCRAM auth doesn't work with plaintext userlist", "`bun --hot` breaks croner timers").
- A canonical decision or invariant the user states (rate limits, naming conventions, deployment topology, security boundary).
- A constraint discovered by failing tests, build errors, or runtime crashes that took non-trivial time to diagnose.
- A schema, env var, or contract surface area you had to reverse-engineer from code.
- A pattern recurring across plugins/apps that should be reused (candidate for `wiki/agents/`).
- A new external dependency, third-party service, or integration with a quirk worth recording.
- A clarification of business or operational scope ("this app does/does not do X").

**Where it goes** — match the audience boundary in [`CONVENTIONS.md`](./wiki/CONVENTIONS.md):

- Architecture, plugins, packages, runtime internals → `wiki/apps/`
- Deploy, charts, CI/CD, env vars, performance, security, logging → `wiki/ops/`
- Schemas, stores, file formats → `wiki/data/`
- Reusable how-to recipes (mocks, scaffolds, code-gen templates) → `wiki/agents/`
- An ingest/migration/cleanup operation → `wiki/sources/<slug>.md` summary + entry in `wiki/log.md`

Use `/wiki-ingest` for substantial additions (it asks the right disambiguation questions), or edit pages directly for small additions when the page and section are obvious.

**Mandatory: reindex after writing.** Whenever you create or modify any file under `wiki/`, run before ending the turn:

```sh
qmd --index buntime update && qmd --index buntime embed
```

Without this, subsequent QMD queries will not see your changes — the canonical-source guarantee depends on the index being current. If multiple wiki edits happen in the same turn, run it once at the end.

**Mandatory: log the change.** Add a one-section entry at the top of [`wiki/log.md`](./wiki/log.md) describing what was added/updated and why. The log is the audit trail of how the wiki evolved — never edit silently.

### Targeted guidance — `audience: agents`

When you need a **how-to recipe** for a recurring task (writing tests, scaffolding a plugin, generating boilerplate), **start by checking [`wiki/agents/`](./wiki/agents/)** — those pages are written specifically for automated agents and contain concrete patterns ready to apply, not human-oriented prose. Search the QMD index with the audience hint: `qmd --index buntime query "<task>"` and prefer hits in `wiki/agents/`. If no `agents` page covers the task, fall back to `apps/` (knowledge) — and consider proposing a new `agents/` page via `/wiki-ingest` when you've absorbed the pattern.

## Policy — wiki vs repo scope

Buntime is a **purely technical runtime** — no business rules of its own. The wiki covers everything (architecture, plugins, deploy, performance, security, data). The code repo only carries:

- This `CLAUDE.md` (and the `AGENTS.md` symlink) — agent execution rules.
- **Minimal package READMEs** (required for JSR/npm) pointing to the wiki for the full reference.
- **Chart release notes** (`charts/release-notes.md`) — injected as an annotation into `Chart.yaml`.

If documentation appears anywhere else (`apps/*/docs/`, `plugins/*/docs/`, README files beyond the bare minimum), treat it as a pending migration to the wiki — use `/wiki-ingest` to consolidate.

If Buntime ever gains business rules (contractual SLA, tenant data retention, hosted SaaS pricing), they go in `wiki/business/` (folder to be created).

## Agent execution rules

The following rules condition agent action and must be followed without lookup. Knowledge (the *what* and *why*) is in the wiki; the rules below are the *do/don't*.

### Release & publishing

- **NEVER** run `bump-version.ts`, `git tag`, or `git push` without **explicit user permission**.
- Every new version **MUST** have its own entry in `charts/release-notes.md` **before** publishing — release notes describe what changed in *that specific version*, not a cumulative changelog.
- Always show the user the exact commands that will be executed and **wait for confirmation** before any release operation.
- **Never publish `@buntime/shared` manually from CLI** — only via the GitHub Actions OIDC workflow (`gh workflow run jsr-publish.yml`). Full flow: [`wiki/ops/jsr-publish.md`](./wiki/ops/jsr-publish.md).
- `packages/shared/jsr.json:version` and `packages/shared/package.json:version` **must always match** — update both together.

### Testing

- **Always run `bun test` before reporting a task complete.** No exceptions.
- Test files live alongside source files as `*.test.ts` (colocated, not in a separate `__tests__/` directory).
- Use `bun:test` (`describe`, `it`, `expect`, `mock`, `spyOn`). The framework is Jest-compatible.
- For plugin changes, write tests covering the new behavior. Concrete patterns (`WorkerPool` mock, `PluginContext` mock, Hono `app.fetch` testing, temp-dir setup, plugin lifecycle test, anti-patterns): [`wiki/agents/testing-patterns.md`](./wiki/agents/testing-patterns.md). Reading existing `plugin.test.ts` files in the same workspace is also a fast way to absorb the conventions.

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

- **Choose ONE API mode per plugin: persistent OR serverless.** Don't duplicate API in both `plugin.ts` and `index.ts`. Reference: [`wiki/apps/plugin-system.md`](./wiki/apps/plugin-system.md#api-modes--persistent-vs-serverless).
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

## Local search (QMD)

The wiki uses [QMD](https://github.com/tobi/qmd) with the named index **`buntime`** (database at `~/.cache/qmd/buntime.sqlite`). **Always pass `--index buntime`** when using the CLI:

```bash
qmd --index buntime query "how does TTL=0 work in the worker pool"
qmd --index buntime update     # after editing wiki files
qmd --index buntime embed      # after adding a new collection
```

Full setup (one-time): [`wiki/QMD.md`](./wiki/QMD.md). The `qmd` MCP is registered in this repo's `.mcp.json` and opens the correct index automatically.
