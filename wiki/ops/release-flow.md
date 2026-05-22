---
title: "Versioning and release flow"
audience: ops
sources:
  - .agents/rules/versioning.md
  - .agents/rules/release.md
  - apps/runtime/docs/deployment/github-actions.md
  - apps/runtime/docs/deployment/gitlab-local.md
  - charts/Chart.yaml
  - charts/release-notes.md
updated: 2026-05-02
tags: [release, ci, github-actions, gitlab, docker, helm]
status: stable
---

# Versioning and release flow

> How Buntime versions the chart vs. the runtime, when to run `bump-version.ts`, what triggers each CI pipeline, and the two parallel flows: GitHub (`main`) and self-hosted GitLab (`test/gitlab-ci`).

To regenerate charts before bumping, see [Helm charts](./helm-charts.md). To publish `@buntime/shared` to JSR, see [JSR publish](./jsr-publish.md).

## Release rules

> **Before anything else**: never run `bump-version.ts`, `git tag`, or `git push` without explicit user permission. Every new version **must** have its own release notes in `charts/release-notes.md` before publishing.

## Two version tracks

Buntime maintains **two independent versions** in sync through pairs of files:

| Version | File | Tracks | Paired with |
|---------|------|--------|-------------|
| `version` | `charts/Chart.yaml` | Chart/release | `package.json` (root) |
| `version` | `package.json` (root) | Chart/release | `charts/Chart.yaml:version` |
| `appVersion` | `charts/Chart.yaml` | Runtime | `apps/runtime/package.json:version` |
| `version` | `apps/runtime/package.json` | Runtime | `charts/Chart.yaml:appVersion` |

Sync rules (validated by Lefthook hooks):

- `apps/runtime/package.json:version` === `Chart.yaml:appVersion`
- `package.json:version` === `Chart.yaml:version`
- The two tracks are **independent** — the chart can be ahead or behind appVersion

**Git tags follow the chart version** (`v0.3.0`, `v0.3.1`, ...), never the appVersion.

### Why keep them separate?

- **`appVersion`** tracks only the runtime code in `apps/runtime/`. It does not change when a plugin changes.
- **The Docker image** contains the runtime + all plugins. A new image is required whenever either changes.
- **Image rebuild** is triggered by a git tag (`v*.*.*`), created via `--tag` in the script.
- The `--tag` flag is tied to the **chart bump**, not to appVersion.

## Unified bump script

```bash
bun scripts/bump-version.ts --chart=<bump> [--app=<bump>] [--tag] [--no-commit] [--no-push]
```

### Flags

| Flag | Required | Effect |
|------|----------|--------|
| `--chart=patch\|minor\|major\|x.y.z` | **Yes** | Bumps `Chart.yaml:version` + root `package.json:version` |
| `--app=patch\|minor\|major\|x.y.z` | No | Bumps `apps/runtime/package.json:version` + `Chart.yaml:appVersion` |
| `--tag` | No | Creates git tag `v{chartVersion}` (triggers Docker CI) |
| `--no-commit` | No | Does not commit |
| `--no-push` | No | Does not push (push happens by default when `--tag` is set) |

### When to use `--tag`

| Change | `--tag`? | `--app`? |
|--------|----------|----------|
| Runtime code (`apps/runtime/`) | **Yes** | **Yes** |
| Plugin code or manifest (`plugins/`) | **Yes** | No |
| Chart only (`charts/templates/`, values) | No | No |
| Chart + runtime together | **Yes** | **Yes** |

> `--app` without `--tag` generates a warning: appVersion changes but there is no image rebuild. This almost always indicates a mistake.

### Automatic validations

- `--chart` missing → error (always required).
- `--app` without `--tag` → warning.

## Lefthook hooks

| Hook | Triggers on | Validates |
|------|-------------|-----------|
| `version-sync` | `package.json`, `apps/runtime/package.json`, or `charts/Chart.yaml` staged | `version`/`appVersion` pairs match |
| `chart-version` | Any `charts/**` staged | `Chart.yaml:version` was bumped |

Fix: `bun scripts/bump-version.ts --chart=<bump>`.

## Common scenarios

### Chart template fix (no image rebuild)

```bash
# 1. Edit charts/templates/ingress.yaml
# 2. Patch bump for chart only
bun scripts/bump-version.ts --chart=patch
# → chart: 0.2.26 → 0.2.27, root: 0.2.27
# → commits (no tag, no push)

git push origin main
# → helm-publish triggers (path in charts/**)
# → no Docker rebuild
```

### Plugin manifest or code change (image rebuild)

```bash
# 1. Edit plugins/plugin-deployments/manifest.yaml or plugin.ts
# 2. Bump chart with tag
bun scripts/bump-version.ts --chart=patch --tag
# → chart: 0.2.26 → 0.2.27, root: 0.2.27
# → commits, tags v0.2.27, pushes
# → docker-publish triggers (tag v0.2.27)
# → helm-publish triggers (charts/** changed via auto-regen)
```

### Runtime change (image rebuild)

```bash
# 1. Edit apps/runtime/src/
# 2. Bump both versions with tag
bun scripts/bump-version.ts --chart=patch --app=patch --tag
# → runtime: 1.1.0 → 1.1.1, appVersion: "1.1.1"
# → chart: 0.2.26 → 0.2.27, root: 0.2.27
# → commits, tags v0.2.27, pushes
# → docker-publish + helm-publish trigger
```

### Preparatory bump without commit

```bash
bun scripts/bump-version.ts --chart=patch --app=patch --no-commit
git add .
git commit -m "fix: …"
```

## Release notes

`charts/release-notes.md` is injected into `Chart.yaml` as `catalog.cattle.io/release-notes` (an annotation read by Rancher).

Rules:

- Describe what changed **in that version**, not cumulatively.
- Keep it relevant to chart consumers (runtime, plugins, helm config). Skip internal tooling.
- Update **before** running `bump-version.ts`.

Typical structure:

```markdown
## What's New

### Runtime
- ...

### CLI
- ...

### Deployment
- ...

### Performance
- ...
```

## Flow 1 — GitHub Actions (branch `main`)

Three workflows publish public infrastructure:

| Workflow | Triggers on | Output |
|----------|-------------|--------|
| `docker-publish.yml` | Tags `v*.*.*` | Image `ghcr.io/zommehq/buntime:{tag,latest,major,major.minor}` |
| `helm-publish.yml` | Push to `main` touching `charts/**` or `plugins/*/manifest.yaml` | Sync to `zommehq/charts` |
| `jsr-publish.yml` | `workflow_dispatch` | `@buntime/shared` on JSR via OIDC |

### Docker image

Tags published to GHCR on each `v*.*.*`:

| Tag | Example |
|-----|---------|
| `latest` | always the most recent |
| `{version}` | `0.2.27` |
| `{major}.{minor}` | `0.2` |
| `{major}` | `0` |

The image contains the runtime + all built-in plugins. The `deployment.yaml` template consumes `image.tag` from the Helm values (default: `latest`).

### Chart sync

`zommehq/charts` is the public catalog repository. Rancher detects a higher `Chart.yaml:version` and displays "Upgrade Available". The publish workflow uses `release-notes.md` to generate the catalog entry.

Retention: `30` days by default (`CLI_ARTIFACT_RETENTION_DAYS`).

Download: **Actions → Build CLI → run → Artifacts**.

## Flow 2 — Self-hosted GitLab (branch `test/gitlab-ci`)

Pipeline in `.gitlab-ci.yml` for the `gitlab.example.com` lab:

| Job | Stage | Role |
|-----|-------|------|
| `image:build` | `image` | Build + push to `ghcr.io/zommehq/buntime` |
| `cli:build:linux` | `cli` | Linux amd64 + arm64 |
| `cli:build:windows` | `cli` | Windows amd64 |
| `cli:build:macos` | `cli` | macOS amd64 + arm64 (shell runner tagged `macos`) |

### Published tags

| Tag | When |
|-----|------|
| `$CI_COMMIT_SHORT_SHA` | Always (immutable image) |
| `$CI_COMMIT_REF_SLUG` | Always (stable per branch/tag) |
| `latest` | Always |
| `$CI_COMMIT_TAG` | Only when the pipeline runs for a git tag |

### Chart catalog

The publish generates to `gitlab.example.com/zomme/charts`. The local Rancher instance points to this repository.

### CLI artifacts on GitLab

Same targets as the GitHub flow, but downloaded under **Project → Build → Pipelines → run → Jobs → Download artifacts**. Retention `CLI_ARTIFACT_EXPIRE_IN` (default `30 days`).

`cli:build:macos` runs automatically on git tags or when `RUN_MACOS_CLI_BUILD=1`; otherwise it is manual on branch pipelines.

### Required runners

| Runner | Tag | Role |
|--------|-----|------|
| Docker executor | `docker` | image:build, Linux CLI, Windows CLI |
| Shell macOS | `macos` | macOS CLI (Go 1.23 + Xcode CLT) |

For the `registry.example.com` registry, the DinD in `image:build` uses `--insecure-registry=registry.example.com`.

### CI/CD variables

GitLab provides `CI_REGISTRY`, `CI_REGISTRY_IMAGE`, `CI_REGISTRY_USER`, `CI_REGISTRY_PASSWORD`. No extra required env vars. Optional:

| Variable | Default | Use |
|----------|---------|-----|
| `CLI_ARTIFACT_EXPIRE_IN` | `30 days` | Artifact retention |
| `RUN_MACOS_CLI_BUILD` | unset | `1` forces macOS build on branches |

### Deploying from GitLab

```yaml
# values-k3s.yaml
image:
  repository: ghcr.io/zommehq/buntime
  tag: runtime-performance-resilience  # or commit SHA
  pullPolicy: Always
imagePullSecrets:
  - name: gitlab-registry
```

Create the secret in the namespace:

```bash
kubectl create secret docker-registry gitlab-registry \
  --namespace zomme \
  --docker-server=registry.example.com \
  --docker-username=<user> \
  --docker-password=<token>
```

## Version flow (visualization)

```
Plugin/manifest changed (no runtime change)
  → bun scripts/bump-version.ts --chart=patch --tag
    → Chart.yaml:version = 0.2.27
    → package.json:version = 0.2.27
    → tag v0.2.27 + push
      → CI: GHCR image updated
      → CI: chart synced to zommehq/charts
      → Rancher detects upgrade

Runtime changed
  → bun scripts/bump-version.ts --chart=patch --app=patch --tag
    → apps/runtime/package.json:version = 1.1.1
    → Chart.yaml:appVersion = "1.1.1"
    → Chart.yaml:version = 0.2.27
    → tag v0.2.27 + push

Chart only changed (templates, values)
  → bun scripts/bump-version.ts --chart=patch
    → Chart.yaml:version = 0.2.27 (no tag)
    → manual git push
      → CI: chart sync only (no Docker rebuild)
```

## Local lab DNS

For `gitlab.example.com`/`rancher.home`/`registry.example.com` to resolve via `dnsmasq`:

```bash
dig @127.0.0.1 gitlab.example.com +short
dig @127.0.0.1 rancher.home +short
dig @127.0.0.1 registry.example.com +short
```

`.home` points to the VM's fixed IP; `dnsmasq` listens on the host (e.g., `192.168.0.5`).
