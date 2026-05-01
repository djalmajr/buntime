# Local GitLab Pipeline

This repository includes a GitLab CI pipeline for the local lab at
`gitlab.example.com`. Its runtime image job builds and pushes the Docker image to the
local GitLab registry so Rancher can deploy that image. CLI build jobs publish
downloadable binaries as GitLab artifacts.

## Pipeline Jobs

| Job | Stage | Purpose |
| --- | --- | --- |
| `image:build` | `image` | Builds and pushes the image to the GitLab registry. |
| `cli:build:linux` | `cli` | Builds Linux CLI artifacts for `amd64` and `arm64`. |
| `cli:build:windows` | `cli` | Builds the Windows CLI artifact for `amd64`. |
| `cli:build:macos` | `cli` | Builds macOS CLI artifacts for `amd64` and `arm64` on a macOS runner. |

The job publishes these tags:

| Tag | Purpose |
| --- | --- |
| `$CI_COMMIT_SHORT_SHA` | Immutable image for an exact commit. |
| `$CI_COMMIT_REF_SLUG` | Stable branch/tag-friendly image for Rancher tests. |
| `latest` | Convenience tag for local lab deploys. |
| `$CI_COMMIT_TAG` | Release tag, only when the pipeline runs for a Git tag. |

## CLI Artifacts

The CLI artifacts are retained for `30 days` by default. Override
`CLI_ARTIFACT_EXPIRE_IN` in GitLab CI/CD variables when a different retention
window is needed.

| Artifact | Job | Notes |
| --- | --- | --- |
| `buntime-linux-amd64.tar.gz` | `cli:build:linux` | Cross-compiled with CGO and `x86_64-linux-gnu-gcc`. |
| `buntime-linux-arm64.tar.gz` | `cli:build:linux` | Cross-compiled with CGO and `aarch64-linux-gnu-gcc`. |
| `buntime-windows-amd64.zip` | `cli:build:windows` | Cross-compiled with CGO and MinGW. |
| `buntime-darwin-amd64.tar.gz` | `cli:build:macos` | Built on a macOS runner with `clang`. |
| `buntime-darwin-arm64.tar.gz` | `cli:build:macos` | Built on a macOS runner with `clang`. |

The CLI uses SQLite via `github.com/mattn/go-sqlite3`, so release binaries are
built with `CGO_ENABLED=1`. Linux and Windows are built on the Docker runner
with cross C toolchains. macOS builds require a native macOS GitLab runner tagged
`macos`. The macOS job runs automatically for Git tags or when
`RUN_MACOS_CLI_BUILD=1`; otherwise it is manual and optional on branch pipelines.

CLI artifact jobs use `needs: []`, so they can start without waiting for the
runtime image build stage.

Download artifacts from the GitLab pipeline page:

```text
Project -> Build -> Pipelines -> <pipeline> -> Jobs -> Download artifacts
```

## GitLab Runner

The image, Linux CLI, and Windows CLI jobs assume a Docker executor runner
tagged `docker`.

Required runner capabilities:

- Pull `docker:24`.
- Pull `golang:1.23-bookworm`.
- Run Docker-in-Docker for `image:build`.
- Reach the local GitLab registry.
- Install Debian build packages inside the Go job containers.

For the lab registry, the Docker-in-Docker service is configured with:

```yaml
--insecure-registry=registry.example.com
```

If the registry is exposed as `gitlab.example.com:5050` instead, update `.gitlab-ci.yml` and the GitLab registry external URL to use that host consistently.

For macOS CLI artifacts, register a separate shell runner on macOS:

```bash
gitlab-runner register \
  --url https://gitlab.example.com \
  --token <runner-token> \
  --executor shell \
  --tag-list macos \
  --description "macOS CLI build runner"
```

The macOS runner must have Go 1.23 and Xcode Command Line Tools installed.

## CI/CD Variables

No project-specific CI/CD variable is required for the image build. The job uses GitLab-provided registry variables:

| Variable | Source | Description |
| --- | --- | --- |
| `CI_REGISTRY` | GitLab | Registry host. |
| `CI_REGISTRY_IMAGE` | GitLab | Project image repository. |
| `CI_REGISTRY_USER` | GitLab | Registry username for the job token. |
| `CI_REGISTRY_PASSWORD` | GitLab | Registry password for the job token. |

Optional variables:

| Variable | Default | Description |
| --- | --- | --- |
| `CLI_ARTIFACT_EXPIRE_IN` | `30 days` | Retention window for CLI binary artifacts. |
| `RUN_MACOS_CLI_BUILD` | unset | Set to `1` to run `cli:build:macos` automatically on branches when a macOS runner is available. |

## Local DNS

The local lab should resolve both GitLab and Rancher names through `dnsmasq`:

```bash
dig @127.0.0.1 gitlab.example.com +short
dig @127.0.0.1 rancher.home +short
dig @127.0.0.1 registry.example.com +short
```

In the current lab, `.home` names point to the fixed VM IP, while `dnsmasq` listens on the local machine address `192.168.0.5`.

## Deploy Flow

1. Push the branch to the local GitLab project.
2. Wait for `image:build` to push the image.
3. In Rancher, use one of the pushed tags:

```yaml
image:
  repository: ghcr.io/zommehq/buntime
  tag: runtime-performance-resilience
  pullPolicy: Always
```

4. Verify through Rancher or CLI:

```bash
helm status buntime -n zomme
kubectl get pods -n zomme -l app.kubernetes.io/name=buntime
kubectl logs -n zomme -l app.kubernetes.io/name=buntime --tail=100
```

## Rancher Registry Pulls

If the GitLab registry is private, create an image pull secret in the target namespace and set it in chart values:

```bash
kubectl create secret docker-registry gitlab-registry \
  --namespace zomme \
  --docker-server=registry.example.com \
  --docker-username=<user> \
  --docker-password=<token>
```

```yaml
imagePullSecrets:
  - name: gitlab-registry
```
