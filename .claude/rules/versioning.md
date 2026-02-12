---
name: versioning
summary: |
  - Chart.yaml has TWO independent versions: `version` (project/chart) and `appVersion` (runtime)
  - Runtime/plugin changes → `bun scripts/bump-version.ts` (bumps appVersion + chart version minor + creates git tag)
  - Chart-only changes (templates/, values) → `bun scripts/bump-chart.ts` (bumps chart version patch, no git tag)
  - Git tags track chart/project version (v0.x.x), NOT appVersion
  - Lefthook pre-commit hooks enforce version sync
---

# Versioning

## Overview

The buntime project uses **semantic versioning** with two independent version tracks:

| Version | Location | Tracks | Synced With |
|---------|----------|--------|-------------|
| `version` | `charts/Chart.yaml` | Project/chart releases | `package.json` root |
| `version` | `package.json` (root) | Project/chart releases | `charts/Chart.yaml` version |
| `appVersion` | `charts/Chart.yaml` | Runtime application | `apps/runtime/package.json` |
| `version` | `apps/runtime/package.json` | Runtime application | `charts/Chart.yaml` appVersion |

**Sync rules:**
- `appVersion` in Chart.yaml === `version` in `apps/runtime/package.json` (always)
- `version` in Chart.yaml === `version` in root `package.json` (always)
- The two tracks are **independent** — chart version can be higher or lower than appVersion

**Git tags** follow the **chart/project version** (`v0.3.0`, `v0.3.1`, etc.), not appVersion.

## Bump Scripts

### `bump-version.ts` — Runtime or plugin changes

Use when runtime source code or any plugin changes.

```bash
bun scripts/bump-version.ts patch   # runtime: 1.0.3 → 1.0.4
bun scripts/bump-version.ts minor   # runtime: 1.0.3 → 1.1.0
bun scripts/bump-version.ts major   # runtime: 1.0.3 → 2.0.0
```

This script updates **4 files**:

| File | Field | Action |
|------|-------|--------|
| `apps/runtime/package.json` | `version` | Bump per argument (patch/minor/major) |
| `charts/Chart.yaml` | `appVersion` | Synced with runtime version |
| `charts/Chart.yaml` | `version` | Auto-bump **minor** |
| `package.json` (root) | `version` | Synced with chart version |

Git operations (disable with `--no-commit`, `--no-tag`, `--no-push`):
- Commits all 4 files
- Creates git tag from **chart version** (e.g., `v0.3.0`)
- Pushes to origin with tags (triggers Docker + Helm CI/CD)

### `bump-chart.ts` — Chart infrastructure changes only

Use when modifying only chart templates, values, or structure (no runtime/plugin code changes).

```bash
bun scripts/bump-chart.ts patch   # 0.2.12 → 0.2.13 (default for infra fixes)
bun scripts/bump-chart.ts minor   # 0.2.12 → 0.3.0
bun scripts/bump-chart.ts major   # 0.2.12 → 1.0.0
```

This script updates **2 files**:

| File | Field | Action |
|------|-------|--------|
| `charts/Chart.yaml` | `version` | Bump per argument |
| `package.json` (root) | `version` | Synced with chart version |

Git operations (disable with `--no-commit`):
- Commits the 2 files
- **No git tag** (no Docker image rebuild needed)
- **No push** (push manually; helm-publish triggers on `charts/**` path match)

### Bump type guidelines

| What changed | Script | Chart version bump |
|-------------|--------|-------------------|
| Runtime source code | `bump-version.ts` | **minor** (auto) |
| Plugin source/manifest | `bump-version.ts` | **minor** (auto) |
| Chart templates/values (infra) | `bump-chart.ts` | **patch** |
| New chart features | `bump-chart.ts` | **minor** |
| Breaking chart changes | `bump-chart.ts` | **major** |

## Pre-commit Hooks (Lefthook)

### `version-sync` Hook

**Triggers:** When `package.json`, `apps/runtime/package.json`, or `charts/Chart.yaml` are staged

**Validates two pairs:**
1. `apps/runtime/package.json:version` === `Chart.yaml:appVersion`
2. `package.json:version` === `Chart.yaml:version`

**Fix:** `bun scripts/bump-version.ts <patch|minor|major>`

### `chart-version` Hook

**Triggers:** When any file in `charts/**` is staged

**Validates:** If chart files changed, `Chart.yaml:version` must also be bumped

**Fix:** `bun scripts/bump-chart.ts patch`

## Examples

### Example 1: Fix chart template bug

```bash
# 1. Edit templates/ingress.yaml
# 2. Bump chart version (patch for infra fix)
bun scripts/bump-chart.ts patch
# → chart: 0.2.12 → 0.2.13, root: 0.2.13
# → commits, no tag, no push

# 3. Push manually
git push origin main
# → helm-publish triggers (path match on charts/**)
```

### Example 2: Runtime feature

```bash
# 1. Edit apps/runtime/src/
# 2. Bump version
bun scripts/bump-version.ts minor
# → runtime: 1.0.3 → 1.1.0, appVersion: "1.1.0"
# → chart: 0.2.12 → 0.3.0, root: 0.3.0
# → commits, tags v0.3.0, pushes
# → docker-publish triggers (tag v0.3.0)
# → helm-publish triggers (charts/** changed)
```

### Example 3: Plugin change

```bash
# 1. Edit plugins/plugin-deployments/
# 2. Bump version (plugins are part of app release)
bun scripts/bump-version.ts patch
# → runtime: 1.0.3 → 1.0.4, appVersion: "1.0.4"
# → chart: 0.2.12 → 0.3.0, root: 0.3.0
# → commits, tags v0.3.0, pushes
```

### Example 4: Chart + runtime changes

```bash
# 1. Edit both
# 2. Use bump-version.ts (handles both tracks)
bun scripts/bump-version.ts patch --no-commit --no-tag --no-push
# 3. Commit manually
git add .
git commit -m "fix: correct API response and Helm values"
```

## CI/CD Integration

### Docker image (GitHub Actions)

Triggered by git tags `v*.*.*` (from `bump-version.ts`):
- Builds `ghcr.io/zommehq/buntime` with tags derived from git tag
- Uses `Chart.yaml:appVersion` as default image tag in deployment template

### Helm chart (GitHub Actions)

Triggered by push to `main` with `charts/**` path changes:
- Regenerates Helm files from base + plugin manifests
- Syncs to `zommehq/charts` repository
- Rancher detects new `Chart.yaml:version` → shows "Upgrade Available"

### GitLab CI

- `docker-build`: triggered by `only: tags`
- `helm-publish`: triggered on `test/gitlab-ci` branch

## Version Flow

```
Developer changes runtime or plugins
  → bun scripts/bump-version.ts patch
    → apps/runtime/package.json:version    = 1.0.4
    → charts/Chart.yaml:appVersion         = "1.0.4"
    → charts/Chart.yaml:version            = 0.3.0   (minor bump)
    → package.json:version                 = 0.3.0   (synced)
    → git tag v0.3.0 + push
      → CI: Docker image ghcr.io/zommehq/buntime:1.0.4
      → CI: Helm chart synced (version 0.3.0)
      → Rancher: sees 0.3.0 > 0.2.12 → "Upgrade Available"

Developer changes chart infra only
  → bun scripts/bump-chart.ts patch
    → charts/Chart.yaml:version            = 0.3.1   (patch bump)
    → package.json:version                 = 0.3.1   (synced)
    → git commit (no tag, no push)
    → git push origin main
      → CI: Helm chart synced (version 0.3.1)
      → Rancher: sees 0.3.1 > 0.3.0 → "Upgrade Available"
      → No Docker rebuild (same image, chart-only change)
```
