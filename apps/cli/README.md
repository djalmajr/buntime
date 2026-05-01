# Buntime CLI

Terminal UI and command-line client for managing a Buntime runtime.

The CLI talks to the runtime over HTTP(S), discovers the configured API base
from `/.well-known/buntime`, and sends the token as `X-API-Key`. This means the
same binary works with the default `/api` base and with Rancher deployments that
mount the runtime API at `/_/api`.

## Build

```bash
cd apps/cli
go build -o buntime .
```

The CLI stores saved server profiles in:

```text
~/.buntime/config.db
```

The local database uses SQLite through CGO. Release artifacts should therefore
be built natively for each target OS, or with a matching C toolchain when
cross-compiling.

## Connect To A Runtime

Local Rancher example:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure
```

Use `--insecure` only for local/self-signed TLS environments. The runtime URL is
the public base URL, not the API path. For example, use `https://buntime.home`,
not `https://buntime.home/_/api`.

Global flags:

| Flag | Description |
| --- | --- |
| `--url`, `-u` | Runtime base URL |
| `--token`, `-t` | Runtime master key or generated API key |
| `--insecure`, `-k` | Skip TLS certificate verification |

## API Keys

Use the runtime master key only to bootstrap administration. For day-to-day app
and plugin uploads, create an `editor` API key in the TUI:

```text
API Keys -> Add
```

Generated keys are returned once by the runtime. Store the value securely and
use it with `--token`.

## TUI Workflow

Start the TUI:

```bash
buntime
```

Or connect directly:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure
```

Common screens:

| Screen | Purpose |
| --- | --- |
| `Manage Apps` | List, install, and remove worker apps |
| `Manage Plugins` | List, install, remove, enable, and disable plugins |
| `API Keys` | List, create, and revoke runtime API keys |
| `Settings` | Edit saved server profile settings |

For installs, the TUI accepts `.zip`, `.tgz`, `.tar.gz`, or a directory. When a
directory is selected, the CLI zips it locally and uploads the archive.

## Command Mode

List plugins:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure plugin list
```

Install a plugin archive:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure plugin install ./my-plugin.zip
```

Remove a plugin:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure plugin remove my-plugin
```

List apps:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure app list
```

Install an app archive:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure app install ./my-app.zip
```

Remove an app:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure app remove my-app
```

Remove a specific app version:

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure app remove my-app 1.0.0
```

## App Package Format

An app archive must contain `manifest.yaml` or `package.json` at the archive
root. Example:

```text
my-app.zip
├── manifest.yaml
├── package.json
└── index.ts
```

Minimal `manifest.yaml`:

```yaml
name: my-app
version: 1.0.0
entrypoint: index.ts
ttl: 5m
timeout: 5s
idleTimeout: 60s
maxBodySize: 10mb
```

Minimal `index.ts`:

```ts
export default {
  fetch: () => new Response("ok"),
};
```

## Plugin Package Format

A plugin archive must contain a plugin `manifest.yaml` at the archive root. For
compiled plugins, include the compiled server entry referenced by
`pluginEntry`.

```text
my-plugin.zip
├── manifest.yaml
└── dist/
    └── server/
        └── index.js
```

## Release Artifacts

The local GitLab pipeline publishes downloadable CLI artifacts for:

| Target | Artifact |
| --- | --- |
| Linux amd64 | `buntime-linux-amd64.tar.gz` |
| Linux arm64 | `buntime-linux-arm64.tar.gz` |
| Windows amd64 | `buntime-windows-amd64.zip` |
| macOS amd64 | `buntime-darwin-amd64.tar.gz` |
| macOS arm64 | `buntime-darwin-arm64.tar.gz` |

See [Local GitLab Pipeline](../runtime/docs/deployment/gitlab-local.md) for
runner requirements and artifact retention.
