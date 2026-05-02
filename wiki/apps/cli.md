---
title: "buntime CLI/TUI (apps/cli)"
audience: dev
sources:
  - apps/cli/README.md
  - apps/cli/docs/**
updated: 2026-05-02
tags: [cli, tui, go, automation]
status: stable
---

# buntime CLI/TUI

> Go client with a TUI (Terminal UI) and command mode for administering a Buntime runtime over HTTP. The same binary manages API keys, installs/removes apps and plugins, and works with any configured prefix (`/api` or `/_/api`) thanks to discovery via `/.well-known/buntime`.

## Overview

| Aspect | Detail |
|---|---|
| Language | Go |
| TUI framework | [Charm Bubble Tea](https://github.com/charmbracelet/bubbletea) (Elm-inspired) |
| TUI components | Bubbles (input, list, spinner, table), Lip Gloss (styling), Harmonica (animation) |
| CLI commands | [Cobra](https://github.com/spf13/cobra) |
| Local storage | SQLite via CGO (server profiles saved in `~/.buntime/config.db`) |
| Transport | HTTP(S), `X-API-Key` header, `--insecure` support for self-signed TLS |
| Discovery | `/.well-known/buntime` resolves the real `apiPrefix` of the runtime |
| Role in the ecosystem | Automation equivalent of [CPanel `/admin`](./cpanel.md) — both hit the same core API |

The CLI is distributed as a standalone binary for Linux/macOS/Windows (see [Release artifacts](#release-artifacts)).

## Local build

```bash
cd apps/cli
go build -o buntime .
```

| Prerequisite | Reason |
|---|---|
| Go toolchain | Compile the binary |
| C toolchain (cgo) | SQLite for local profile storage (`~/.buntime/config.db`) |

Because of cgo, **release artifacts are compiled natively** on each OS/arch or use a compatible C toolchain for cross-compilation. Pipeline details are in [release flow](../ops/release-flow.md).

### Local storage

```text
~/.buntime/config.db
```

Local SQLite stores server profiles (URL, token, insecure flag, last used). This allows quick switching between runtimes (local dev, staging Rancher, production) without re-authenticating.

## Runtime connection

| Flag | Short | Description |
|---|---|---|
| `--url` | `-u` | Runtime base URL (e.g., `https://buntime.home`) — does not include `/api` |
| `--token` | `-t` | API key (master or generated) sent as `X-API-Key` |
| `--insecure` | `-k` | Skip TLS certificate verification (dev/self-signed only) |

Local Rancher example:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure
```

> The URL is the **public base**, not the API path. Use `https://buntime.home`, never `https://buntime.home/_/api`. The CLI discovers the real prefix by querying `/.well-known/buntime`.

## API keys

| Scenario | Recommendation |
|---|---|
| Initial bootstrap | Use the `RUNTIME_MASTER_KEY` (configured on the runtime) |
| Day-to-day operations | Create dedicated keys in the TUI: `API Keys → Add` |
| CI/CD automation | Create an `editor` key and store it as a pipeline secret |
| Inspection/read-only | Create a `viewer` key |

Generated keys are returned **only once** by the runtime (same behavior as the CPanel `/admin` — see [Admin console](./cpanel.md#admin-area)). Store the value securely and use it with `--token`.

The available profiles (`admin`/`editor`/`viewer`/`custom`) and the permission matrix are **identical to those in the CPanel** because both hit the same core API; see [`cpanel.md`](./cpanel.md#profiles-and-capabilities).

## TUI (interactive mode)

Launch without a subcommand:

```bash
buntime
# or already connected
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure
```

| Screen | Purpose |
|---|---|
| `Manage Apps` | List, install, and remove apps (workers) |
| `Manage Plugins` | List, install, remove, enable, and disable plugins |
| `API Keys` | List, create, and revoke API keys |
| `Settings` | Edit the saved server profile |

### Visual identity

The TUI follows a design intended for modern terminals (see `apps/cli/docs/tui-design.adoc`):

| Color | Usage | Hex |
|---|---|---|
| Primary (Cyan) | Selected items, active elements | `#00D9FF` |
| Secondary (Purple) | Accents | `#BD93F9` |
| Success (Green) | Enabled status | `#50FA7B` |
| Warning (Yellow) | Pending | `#F1FA8C` |
| Error (Red) | Errors, disabled | `#FF5555` |
| Muted (Gray) | Descriptions, inactive | `#6272A4` |

### Accepted package formats for installs

For apps and plugins, the TUI uploader accepts:

| Format | Behavior |
|---|---|
| `.zip` | Sent directly |
| `.tgz` / `.tar.gz` | Sent directly |
| Directory | TUI zips it locally and sends the resulting file |

The final endpoint is `POST /api/apps/upload` or `POST /api/plugins/upload` on the runtime.
The runtime installs into the configured uploaded root (`/data/apps` or
`/data/plugins` in Helm). Items reported as `built-in` are read-only from the
CLI/TUI perspective; delete actions must be offered only when the API returns
`removable=true`.

## Command mode (non-interactive)

Use subcommands for automation:

```bash
buntime [global flags] <resource> <action> [args]
```

### Plugins

```bash
# list
buntime --url <url> --token <t> plugin list

# install
buntime --url <url> --token <t> plugin install ./my-plugin.zip

# remove
buntime --url <url> --token <t> plugin remove my-plugin

# remove specific version
buntime --url <url> --token <t> plugin remove my-plugin 1.0.0

# enable / disable
buntime --url <url> --token <t> plugin enable my-plugin
buntime --url <url> --token <t> plugin disable my-plugin
```

### Apps

```bash
buntime --url <url> --token <t> app list
buntime --url <url> --token <t> app install ./my-app.zip
buntime --url <url> --token <t> app remove my-app
buntime --url <url> --token <t> app remove my-app 1.0.0
```

> The `--insecure` flag is required for local Rancher and similar setups with self-signed TLS; do not use it in production.

## Package format

### App

The archive must contain `manifest.yaml` or `package.json` at the root:

```text
my-app.zip
├── manifest.yaml
├── package.json
└── index.ts
```

Minimal manifest:

```yaml
name: my-app
version: 1.0.0
entrypoint: index.ts
ttl: 5m
timeout: 5s
idleTimeout: 60s
maxBodySize: 10mb
```

Minimal entry:

```ts
export default {
  fetch: () => new Response("ok"),
};
```

See [Plugin deployments](./plugin-deployments.md) for the full upload, validation, and activation pipeline.

### Plugin

The archive must contain a plugin `manifest.yaml` at the root; for compiled plugins, include the entry referenced by `pluginEntry`:

```text
my-plugin.zip
├── manifest.yaml
└── dist/
    └── server/
        └── index.js
```

## Internal code structure

```text
apps/cli/
├── main.go                 # Cobra root + subcommands
├── go.mod
├── go.sum
├── internal/
│   ├── api/                # HTTP client (well-known, X-API-Key)
│   ├── db/                 # local SQLite (saved profiles)
│   └── tui/                # Bubble Tea views, models, and messages
└── docs/
    └── tui-design.adoc
```

| Internal package | Responsibility |
|---|---|
| `internal/api` | Typed HTTP client: well-known discovery, multipart encoding for uploads, runtime response parsing |
| `internal/db` | Local profile persistence in SQLite |
| `internal/tui` | Bubble Tea implementation — per-screen models, messages, rendering via Lip Gloss |

## Release artifacts

GitHub Actions and the self-hosted GitLab pipeline publish binaries for:

| Target | Artifact |
|---|---|
| Linux amd64 | `buntime-linux-amd64.tar.gz` |
| Linux arm64 | `buntime-linux-arm64.tar.gz` |
| Windows amd64 | `buntime-windows-amd64.zip` |
| macOS amd64 | `buntime-darwin-amd64.tar.gz` |
| macOS arm64 | `buntime-darwin-arm64.tar.gz` |

GitHub Actions retains artifacts for **30 days**. Download from:

```text
Actions → Build CLI → <run> → Artifacts
```

Operational details (runners, cgo cross-toolchain, retention policy) are in [release flow](../ops/release-flow.md).

## CLI vs CPanel `/admin`

Both target the same core runtime API (`/api/admin/session`, `/api/apps/upload`, `/api/plugins/*`, etc.). The difference is the use case:

| Scenario | Use |
|---|---|
| Operators who live in the terminal | CLI/TUI |
| CI/CD automation | CLI in command mode |
| Ad-hoc browser operation, no binary install | [CPanel `/admin`](./cpanel.md) |
| Initial bootstrap without TLS configured | CLI with `--insecure` |
| Non-technical teams with authorized access | CPanel `/admin` |

## Cross-references

- Endpoints consumed by the CLI: [Runtime API reference](./runtime-api-reference.md)
- Upload, validation, and activation pipeline: [`plugin-deployments`](./plugin-deployments.md)
- Build and artifact publishing pipeline: [release flow](../ops/release-flow.md)
- Browser-based equivalent: [CPanel](./cpanel.md)
