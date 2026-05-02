---
title: "Publishing @buntime/shared to JSR"
audience: ops
sources:
  - .agents/rules/jsr-publish.md
updated: 2026-05-02
tags: [jsr, npm, publishing]
status: stable
---

# Publishing `@buntime/shared` to JSR

> `@buntime/shared` is the only package in the Buntime monorepo published on [jsr.io](https://jsr.io/@buntime/shared) — consumed by external plugins via `bunx jsr add`. Publishing is exclusively done via GitHub Actions with OIDC. **Never run manually from the CLI.**

For details on the package contents (exports, helpers, errors, logger), see [`../apps/packages.md`](../apps/packages.md). For the general project release flow (chart, runtime, CLI), see [Release flow](./release-flow.md).

## Why JSR instead of npm

The other monorepo packages (`@buntime/database`, `@buntime/keyval`, `@buntime/plugin-*`) are private and consumed via `workspace:*` only within the mono. **External** plugins that run on the runtime need the types and utilities from `@buntime/shared` (`PluginImpl`, `PluginContext`, logger, errors, string/size/duration helpers). JSR was chosen for:

- Native TypeScript support (no build step)
- OIDC authentication via GitHub Actions (no long-lived tokens)
- Resolution via `bunx jsr add @buntime/shared`

## Flow

1. Update `packages/shared/jsr.json` and `packages/shared/package.json` (versions in sync)
2. Update the package release notes if there are API changes
3. Commit and push to `main`
4. Trigger the `JSR Publish` workflow via `workflow_dispatch`
5. In each external consumer plugin: `bunx jsr add @buntime/shared`

## Trigger

```bash
# Version read from jsr.json
gh workflow run jsr-publish.yml

# Explicit override (to force a specific version)
gh workflow run jsr-publish.yml -f version=1.0.3
```

After triggering, monitor via `gh run watch` or in the **Actions → JSR Publish** tab.

## Files involved

| File | Role |
|------|------|
| `packages/shared/jsr.json` | JSR metadata: `name`, `version`, `exports`, `exclude` |
| `packages/shared/package.json` | npm metadata: `version` (must match `jsr.json`) |
| `.github/workflows/jsr-publish.yml` | OIDC workflow, `workflow_dispatch` trigger |

## Version sync

> **Hard rule**: `jsr.json:version` and `package.json:version` must be identical.

Always update both in the same commit. There is no hook validating this — forgetting causes an inconsistent publish (workspace consumers see one version, JSR consumers see another).

## Adding a new export

When adding a new module to `@buntime/shared`:

1. Add it to `package.json` in the `exports` field (for workspace consumers)
2. Add it to `jsr.json` in the `exports` field (for JSR consumers)
3. Remove it from `jsr.json:exclude` if it was previously excluded
4. Bump `version` in both files
5. Commit, push, and trigger `gh workflow run jsr-publish.yml`

Typical entry example:

```jsonc
// jsr.json
{
  "name": "@buntime/shared",
  "version": "1.0.4",
  "exports": {
    "./logger": "./src/logger/index.ts",
    "./types": "./src/types/index.ts",
    "./utils/string": "./src/utils/string.ts"
  },
  "exclude": ["**/*.test.ts"]
}
```

```jsonc
// package.json
{
  "name": "@buntime/shared",
  "version": "1.0.4",
  "exports": {
    "./logger": "./src/logger/index.ts",
    "./types": "./src/types/index.ts",
    "./utils/string": "./src/utils/string.ts"
  }
}
```

## Updating consumers

In each external plugin:

```bash
cd /path/to/external-plugin
bunx jsr add @buntime/shared@^1.0.4
```

JSR creates/updates the entry in `package.json` and downloads the package.

## Cross-refs

- Contents of `@buntime/shared` (logger, types, errors, utils): [`../apps/packages.md`](../apps/packages.md)
- Logging system used by the runtime: [Logging](./logging.md)
- Shared errors: [`../apps/packages.md`](../apps/packages.md) (errors section)
