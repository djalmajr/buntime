---
name: versioning
summary: |
  - Single script: `bun scripts/bump-version.ts --chart=<bump> [--app=<bump>] [--tag]`
  - `--chart` is REQUIRED (always bumps chart version)
  - `--app` is OPTIONAL (only when runtime source code changes)
  - `--tag` creates git tag → triggers Docker image build via CI
  - appVersion tracks ONLY the runtime (apps/runtime/), never plugins
  - Docker image contains runtime + plugins; rebuild via --tag when either changes
  - Chart-only changes (templates, values) don't need --tag (no image rebuild)
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

## Key Concepts

### appVersion vs Docker image

- `appVersion` tracks **only** the runtime source code (`apps/runtime/`). It does NOT change when plugins change.
- The **Docker image** contains both runtime AND plugins. A new image is needed when either changes.
- Image rebuilds are triggered by **git tags** (`v*.*.*`), created via `--tag` flag.
- The `--tag` flag is tied to chart version bumps, NOT to appVersion.

### When to use --tag

| What changed | Needs `--tag`? | Needs `--app`? |
|-------------|----------------|----------------|
| Runtime source code (`apps/runtime/`) | YES | YES |
| Plugin code or manifest (`plugins/`) | YES | NO |
| Chart templates/values (`charts/`) | NO | NO |
| Chart + runtime together | YES | YES |

## Unified Bump Script

```bash
bun scripts/bump-version.ts --chart=<bump> [--app=<bump>] [--tag] [--no-commit] [--no-push]
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--chart=patch\|minor\|major\|x.y.z` | **YES** | Bumps `Chart.yaml:version` + root `package.json:version` |
| `--app=patch\|minor\|major\|x.y.z` | No | Bumps `apps/runtime/package.json:version` + `Chart.yaml:appVersion` |
| `--tag` | No | Creates git tag `v{chartVersion}` (triggers Docker build CI) |
| `--no-commit` | No | Skip git commit |
| `--no-push` | No | Skip git push (push happens by default when `--tag`) |

### Files updated

| Flag | Files modified |
|------|---------------|
| `--chart` (always) | `charts/Chart.yaml` version, root `package.json` version |
| `--app` (optional) | `apps/runtime/package.json` version, `charts/Chart.yaml` appVersion |

### Validations

- Missing `--chart` → error (always required)
- `--app` without `--tag` → warning (appVersion changes but no Docker rebuild)

## Examples

### Example 1: Chart template fix (no image rebuild)

```bash
# 1. Edit charts/templates/ingress.yaml
# 2. Bump chart version
bun scripts/bump-version.ts --chart=patch
# → chart: 0.2.14 → 0.2.15, root: 0.2.15
# → commits (no tag, no push)

# 3. Push manually
git push origin main
# → helm-publish triggers (path match on charts/**)
# → No Docker rebuild
```

### Example 2: Plugin manifest or code change (image rebuild needed)

```bash
# 1. Edit plugins/plugin-deployments/manifest.yaml
# 2. Bump chart version with tag
bun scripts/bump-version.ts --chart=patch --tag
# → chart: 0.2.14 → 0.2.15, root: 0.2.15
# → commits, tags v0.2.15, pushes
# → docker-publish triggers (tag v0.2.15)
# → helm-publish triggers (charts/** changed)
```

### Example 3: Runtime change (image rebuild needed)

```bash
# 1. Edit apps/runtime/src/
# 2. Bump both versions with tag
bun scripts/bump-version.ts --chart=patch --app=patch --tag
# → runtime: 1.0.3 → 1.0.4, appVersion: "1.0.4"
# → chart: 0.2.14 → 0.2.15, root: 0.2.15
# → commits, tags v0.2.15, pushes
# → docker-publish triggers (tag v0.2.15)
# → helm-publish triggers (charts/** changed)
```

### Example 4: Runtime + chart changes together

```bash
# 1. Edit both apps/runtime/ and charts/
# 2. Bump both
bun scripts/bump-version.ts --chart=minor --app=minor --tag
# → runtime: 1.0.3 → 1.1.0, appVersion: "1.1.0"
# → chart: 0.2.14 → 0.3.0, root: 0.3.0
# → commits, tags v0.3.0, pushes
```

### Example 5: Prepare without committing

```bash
bun scripts/bump-version.ts --chart=patch --app=patch --no-commit
# → Updates files only, no git operations
# → Useful when you want to include version bump in a manual commit
git add .
git commit -m "fix: correct API response and add injectBase to plugins"
```

## Pre-commit Hooks (Lefthook)

### `version-sync` Hook

**Triggers:** When `package.json`, `apps/runtime/package.json`, or `charts/Chart.yaml` are staged

**Validates two pairs:**
1. `apps/runtime/package.json:version` === `Chart.yaml:appVersion`
2. `package.json:version` === `Chart.yaml:version`

**Fix:** `bun scripts/bump-version.ts --chart=<bump> [--app=<bump>]`

### `chart-version` Hook

**Triggers:** When any file in `charts/**` is staged

**Validates:** If chart files changed, `Chart.yaml:version` must also be bumped

**Fix:** `bun scripts/bump-version.ts --chart=patch`

## CI/CD Integration

### Docker image (GitHub Actions)

Triggered by git tags `v*.*.*` (from `--tag` flag):
- Builds `ghcr.io/zommehq/buntime` with tags: `latest`, `{version}`, `{major}.{minor}`, `{major}`
- Image contains runtime + all builtin plugins
- Deployment template uses `image.tag` from Helm values (default: `latest`)

### Helm chart (GitHub Actions)

Triggered by push to `main` with `charts/**` or `plugins/*/manifest.yaml` path changes:
- Regenerates Helm files from base + plugin manifests
- Syncs to `zommehq/charts` repository
- Rancher detects new `Chart.yaml:version` → shows "Upgrade Available"

## Version Flow

```
Plugin or manifest changed (no runtime change)
  → bun scripts/bump-version.ts --chart=patch --tag
    → charts/Chart.yaml:version            = 0.2.15  (patch bump)
    → package.json:version                 = 0.2.15  (synced)
    → git tag v0.2.15 + push
      → CI: Docker image ghcr.io/zommehq/buntime:latest (rebuilt)
      → CI: Helm chart synced (version 0.2.15)
      → Rancher: sees 0.2.15 > 0.2.14 → "Upgrade Available"

Runtime changed
  → bun scripts/bump-version.ts --chart=patch --app=patch --tag
    → apps/runtime/package.json:version    = 1.0.4
    → charts/Chart.yaml:appVersion         = "1.0.4"
    → charts/Chart.yaml:version            = 0.2.15  (patch bump)
    → package.json:version                 = 0.2.15  (synced)
    → git tag v0.2.15 + push
      → CI: Docker image ghcr.io/zommehq/buntime:latest (rebuilt)
      → CI: Helm chart synced (version 0.2.15)

Chart infra changed (no image rebuild needed)
  → bun scripts/bump-version.ts --chart=patch
    → charts/Chart.yaml:version            = 0.2.15  (patch bump)
    → package.json:version                 = 0.2.15  (synced)
    → git commit (no tag, no push)
    → git push origin main
      → CI: Helm chart synced (version 0.2.15)
      → No Docker rebuild (same image, chart-only change)
```
