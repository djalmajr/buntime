# GitHub Actions

This repository uses GitHub Actions for public release infrastructure:

- `docker-publish.yml` builds and publishes the runtime image to GHCR.
- `helm-publish.yml` publishes the Rancher/Helm catalog to `zommehq/charts`.
- `jsr-publish.yml` publishes `@buntime/shared` to JSR.
- `cli-build.yml` builds downloadable CLI binaries for Linux, Windows, and macOS.

## CLI Build Workflow

The CLI build workflow is `.github/workflows/cli-build.yml`.

It runs on:

- Manual dispatch.
- Pull requests that change `apps/cli/**` or the workflow itself.
- Pushes to `main` that change `apps/cli/**` or the workflow itself.
- Version tags matching `v*.*.*`.

The workflow first runs `go test ./...` in `apps/cli`, then builds each target
with `CGO_ENABLED=1` because the CLI uses SQLite through
`github.com/mattn/go-sqlite3`.

## Artifacts

Artifacts are retained for `30` days by default through
`CLI_ARTIFACT_RETENTION_DAYS`.

| Target | Runner | Artifact |
| --- | --- | --- |
| Linux amd64 | `ubuntu-latest` | `buntime-linux-amd64.tar.gz` |
| Linux arm64 | `ubuntu-latest` with `aarch64-linux-gnu-gcc` | `buntime-linux-arm64.tar.gz` |
| Windows amd64 | `windows-latest` with MSYS2 MinGW | `buntime-windows-amd64.zip` |
| macOS amd64 | `macos-latest` with `clang -arch x86_64` | `buntime-darwin-amd64.tar.gz` |
| macOS arm64 | `macos-latest` with `clang -arch arm64` | `buntime-darwin-arm64.tar.gz` |

Download artifacts from:

```text
Actions -> Build CLI -> <run> -> Artifacts
```

## Versioning

For tag builds, the binary version is the tag name without the leading `v`.
For branch, pull request, and manual builds, the binary version is the short
commit SHA.

The version is injected with:

```text
-ldflags="-s -w -X main.version=${VERSION}"
```

## Toolchains

Linux targets are built from Ubuntu with explicit C toolchains:

- `x86_64-linux-gnu-gcc` for Linux amd64.
- `aarch64-linux-gnu-gcc` for Linux arm64.

Windows uses `msys2/setup-msys2` to install `mingw-w64-x86_64-gcc`.

macOS uses the hosted macOS runner and `clang -arch` to build both Intel and
Apple Silicon artifacts.
