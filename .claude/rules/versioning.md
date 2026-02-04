---
name: versioning
summary: |
  - Chart.yaml has TWO versions: `version` (chart) and `appVersion` (runtime)
  - Chart changes (templates/, values.yaml) → bump `version` via `bun scripts/bump-chart.ts`
  - Runtime changes (apps/runtime/) → bump via `bun scripts/bump-version.ts` (syncs both)
  - Lefthook pre-commit hooks enforce version bumps automatically
---

# Versioning

## Overview

The buntime project uses **semantic versioning** with two distinct version tracks:

| Version | Location | Tracks | Bump Script |
|---------|----------|--------|-------------|
| `version` | `charts/buntime/Chart.yaml` | Helm chart structure/templates | `bun scripts/bump-chart.ts` |
| `appVersion` | `charts/buntime/Chart.yaml` | Runtime application | `bun scripts/bump-version.ts` |
| `version` | `apps/runtime/package.json` | Runtime application | `bun scripts/bump-version.ts` |

**Important:** `appVersion` in Chart.yaml and `version` in package.json must always be in sync.

## When to Bump Which Version

### Chart Version (`charts/buntime/Chart.yaml` → `version`)

Bump when modifying:
- `charts/buntime/templates/**` (deployment, configmap, ingress, etc.)
- `charts/buntime/values.yaml`
- `charts/buntime/configmap.base.yaml`
- `charts/buntime/Chart.yaml` metadata (not version fields)

```bash
# For fixes/patches
bun scripts/bump-chart.ts patch   # 0.2.6 → 0.2.7

# For new features
bun scripts/bump-chart.ts minor   # 0.2.6 → 0.3.0

# For breaking changes
bun scripts/bump-chart.ts major   # 0.2.6 → 1.0.0
```

### App Version (`apps/runtime/` changes)

Bump when modifying:
- `apps/runtime/src/**` (runtime source code)
- `apps/runtime/package.json` dependencies
- Core functionality that affects the running application

```bash
# For fixes/patches
bun scripts/bump-version.ts patch   # 1.0.0 → 1.0.1

# For new features
bun scripts/bump-version.ts minor   # 1.0.0 → 1.1.0

# For breaking changes
bun scripts/bump-version.ts major   # 1.0.0 → 2.0.0
```

This script automatically:
1. Updates `apps/runtime/package.json` → `version`
2. Updates `charts/buntime/Chart.yaml` → `appVersion`
3. Creates a git commit with tag (optional flags: `--no-commit`, `--no-tag`, `--no-push`)

## Pre-commit Hooks (Lefthook)

The repository uses [Lefthook](https://github.com/evilmartians/lefthook) to enforce versioning rules:

### `version-sync` Hook

**Triggers:** When `apps/runtime/package.json` or `charts/buntime/Chart.yaml` are staged

**Validates:** `package.json:version` === `Chart.yaml:appVersion`

**Fix:** `bun scripts/bump-version.ts <patch|minor|major>`

### `chart-version` Hook

**Triggers:** When any file in `charts/buntime/**` is staged

**Validates:** If chart files changed (templates, values, etc.), `Chart.yaml:version` must also be bumped

**Fix:** `bun scripts/bump-chart.ts <patch|minor|major>`

## Semantic Versioning Guidelines

Follow [semver.org](https://semver.org/) conventions:

| Type | When to Use | Example |
|------|-------------|---------|
| **patch** | Bug fixes, minor tweaks, docs | Fix typo in configmap |
| **minor** | New features, backwards compatible | Add new Helm value |
| **major** | Breaking changes | Change value structure |

## Examples

### Example 1: Fix Helm template bug

```bash
# 1. Make your changes to templates/deployment.yaml
# 2. Bump chart version
bun scripts/bump-chart.ts patch

# 3. Commit (pre-commit hook validates version)
git add charts/buntime/
git commit -m "fix(chart): correct volume mount path"
```

### Example 2: Add new runtime feature

```bash
# 1. Make changes to apps/runtime/src/
# 2. Bump app version (syncs Chart.yaml appVersion)
bun scripts/bump-version.ts minor --no-commit --no-tag --no-push

# 3. Commit manually
git add apps/runtime/ charts/buntime/Chart.yaml
git commit -m "feat(runtime): add health check endpoint"
```

### Example 3: Change both chart and runtime

```bash
# 1. Make changes to both
# 2. Bump app version first (if runtime changed)
bun scripts/bump-version.ts patch --no-commit --no-tag --no-push

# 3. Bump chart version (if chart structure changed)
bun scripts/bump-chart.ts patch

# 4. Commit all
git add .
git commit -m "fix: correct API response and Helm values"
```

## CI/CD Integration

The version in `Chart.yaml:appVersion` is used as the Docker image tag in CI/CD:

- **GitLab CI** (branch `test/gitlab-ci`): `registry.example.com/buntime:${appVersion}`
- **GitHub Actions** (branch `main`): `ghcr.io/zommehq/buntime:${appVersion}`

When deploying via Helm, the chart uses `appVersion` to pull the correct image:

```yaml
# In deployment.yaml template
image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
```
