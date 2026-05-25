---
title: Wiki Conventions
audience: mixed
updated: 2026-05-02
tags: [meta]
status: stable
---

# Wiki Conventions

## Language

- Content in **en-US** — the project may have an international audience
- Technical terms and identifiers remain in **English** (e.g. worker, plugin, deploy, branch)

## Frontmatter

All pages must include YAML frontmatter with the following fields:

```yaml
---
title: "Page Title"
audience: dev          # business | dev | ops | mixed
sources:               # optional — list of source files
  - path/to/source.md
updated: 2026-05-02
tags: [tag1, tag2]
status: stable         # draft | stable | deprecated
---
```

## Audience

| Value      | Description                          |
|------------|--------------------------------------|
| `business` | Business rules (Buntime has few — the runtime is technical) |
| `dev`      | Development, runtime, plugins, code |
| `ops`      | Operations, infra, deploy, charts, CI |
| `agents`   | Patterns and conventions whose primary consumer is an automated agent (mocking, scaffolding, code-gen recipes). Behavioral *do/don't* rules live in `/CLAUDE.md`, not here — this audience is for *how-to* references the agent looks up at task time. |
| `mixed`    | Cross-cutting content               |

## Status

| Value        | Description                              |
|--------------|------------------------------------------|
| `draft`      | Under construction, may change at any time |
| `stable`     | Reviewed and reliable                   |
| `deprecated` | Replaced or outdated                    |

## Links

- Use standard markdown: `[text](./path.md)`
- Do not use wikilinks (`[[page]]`)
- Do not duplicate content — use cross-references between pages
- When possible, reference the original source (`apps/runtime/docs/...`, `.agents/rules/...`) using a path relative to the repo root

## Folder Structure

| Folder     | Audience  | Content                           |
|------------|-----------|-----------------------------------|
| `apps/`    | dev       | Application docs (runtime, cpanel, cli, vault) and plugins |
| `ops/`     | ops       | Operations, Helm charts, deploy, CI, versioning, JSR |
| `data/`    | dev       | Data models (LibSQL, file stores) |
| `agents/`  | agents    | How-to patterns for agents (testing recipes, scaffolding, code-gen helpers) |
| `sources/` | mixed     | Summaries of ingest operations |
| `raw/`     | mixed     | Raw sources before processing (empty today) |

> **Do not create `business/`** until there are real business rules (Buntime today is purely technical — any relevant "business" rules live in the product that consumes the runtime, not here).
