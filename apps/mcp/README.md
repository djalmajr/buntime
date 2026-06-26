# @buntime/mcp

Local [MCP](https://modelcontextprotocol.io) server for managing a **remote
Buntime runtime** from an AI agent (Claude Code, Claude Desktop, etc.). It is a
thin stdio client over the runtime's management REST API: you give it a runtime
URL and an API key, and it exposes the same surface the cpanel uses — and more —
as MCP tools.

Authorization is enforced **server-side** by the runtime: the server advertises
every tool, but the runtime rejects any action the API key's role or namespaces
do not allow (exactly like the cpanel shows all UI but the runtime decides).

## Configuration

| Env var | Required | Description |
|---|---|---|
| `BUNTIME_URL` | yes | Runtime base URL, e.g. `https://buntime.example.com`. |
| `BUNTIME_API_KEY` | yes | Root key or a generated `btk_*` key. Sent as `X-API-Key`. |
| `BUNTIME_ORIGIN` | no | `Origin` header override (defaults to the base URL origin). |
| `BUNTIME_API_PATH` | no | Explicit API path (e.g. `/_/api`); otherwise discovered from `/.well-known/buntime`. |

## Use it with Claude Code / Claude Desktop

Run it directly from source with Bun (no build step needed):

```json
{
  "mcpServers": {
    "buntime": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/buntime/apps/mcp/src/index.ts"],
      "env": {
        "BUNTIME_URL": "https://buntime.example.com",
        "BUNTIME_API_KEY": "btk_..."
      }
    }
  }
}
```

## Tools

| Group | Tools |
|---|---|
| System | `health_check`, `whoami` |
| Workers | `list_workers`, `upload_worker`, `enable_worker`, `disable_worker`, `delete_worker` |
| Plugins | `list_plugins`, `list_loaded_plugins`, `upload_plugin`, `reload_plugins`, `enable_plugin`, `disable_plugin`, `delete_plugin` |
| API keys | `list_keys`, `keys_meta`, `create_key`, `revoke_key` |
| App-shell (gateway) | `get_shell`, `set_shell_dir`, `reset_shell_dir`, `list_shell_routes`, `set_shell_route`, `remove_shell_route`, `list_shell_excludes`, `add_shell_exclude`, `remove_shell_exclude` |
| Proxy (redirects) | `list_redirects`, `set_redirect`, `remove_redirect` |

`upload_worker` / `upload_plugin` accept either a built archive
(`.tgz`/`.tar.gz`/`.zip`) or a directory, which is packed automatically from
`manifest.yaml` + `package.json` + `dist` (override with `include`). The default
pack set also includes a root `index.ts`/`index.js` entrypoint (serverless workers).

## Updating the app shell

Updating an app-shell is two steps: upload the shell worker, then point the
gateway at it.

- Global shell (default for all hosts): `upload_worker` then `set_shell_dir(dir)`.
- Per-tenant shell: `upload_worker` then `set_shell_route(host, dir)`. Different
  tenants can run different shells, or the same shell pinned to a different
  version. `host` is exact (`tenant.example.com`) or wildcard (`*.example.com`);
  hosts without a route fall back to the global shell.
- Re-upload the same version (upsert) to ship changes in place, or bump the
  version and repoint the route for an atomic switch.

Routes are stored in the gateway (Turso) and applied without a restart. The
`*_shell_exclude` tools control which apps render standalone instead of being
wrapped by the shell (e.g. apps embedded via z-frame).

## Local dev against a k8s runtime

In production point `BUNTIME_URL` at the runtime's ingress hostname
(`https://buntime.<domain>`) — stable, no extra process.

For a local k8s lab, the runtime's `NodePort` is randomly reassigned on each
redeploy, so don't hardcode it. Instead open a dedicated, auto-reconnecting
port-forward in its own terminal and point the MCP at a stable `localhost` port:

```bash
export KUBECONFIG=~/.kube/<your-cluster>.yaml   # or set BUNTIME_KUBECONFIG
bun run --filter @buntime/mcp port-forward       # localhost:8800 -> svc/buntime:8000
```

Then set the MCP `BUNTIME_URL` to `http://localhost:8800` and verify with
`curl -s http://localhost:8800/.well-known/buntime`. Override defaults via
`BUNTIME_NAMESPACE`, `BUNTIME_SERVICE`, `BUNTIME_LOCAL_PORT`, `BUNTIME_REMOTE_PORT`.

## Develop

```bash
bun run --filter @buntime/mcp lint   # biome + tsc
bun run --filter @buntime/mcp test   # bun:test
bun run --filter @buntime/mcp build  # bundle to dist/index.js
```
