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

`upload_worker` / `upload_plugin` accept either a built archive
(`.tgz`/`.tar.gz`/`.zip`) or a directory, which is packed automatically from
`manifest.yaml` + `package.json` + `dist` (override with `include`).

## Develop

```bash
bun run --filter @buntime/mcp lint   # biome + tsc
bun run --filter @buntime/mcp test   # bun:test
bun run --filter @buntime/mcp build  # bundle to dist/index.js
```
