---
description: "Buntime runtime plugins - execution order, configuration, routes, and available plugins"
alwaysApply: false
---

# Buntime Plugins (Runtime)

Runtime plugins for Buntime runner. Located in `plugins/plugin-*/` folders.

## Available Plugins

| Plugin | Package | Priority | Purpose |
|--------|---------|----------|---------|
| [Metrics](../../../plugins/plugin-metrics/README.md) | `@buntime/plugin-metrics` | 0 | Pool metrics, Prometheus, SSE |
| [Proxy](../../../plugins/plugin-proxy/README.md) | `@buntime/plugin-proxy` | 5 | HTTP/WebSocket proxy |
| [AuthN](../../../plugins/plugin-authn/README.md) | `@buntime/plugin-authn` | 10 | JWT/OIDC/Keycloak auth |
| [Gateway](../../../plugins/plugin-gateway/README.md) | `@buntime/plugin-gateway` | 15 | Rate limiting, caching, CORS |
| [AuthZ](../../../plugins/plugin-authz/README.md) | `@buntime/plugin-authz` | 20 | XACML-like policies |
| [Durable](../../../plugins/plugin-durable/README.md) | `@buntime/plugin-durable` | 25 | Stateful actors |
| [KeyVal](../../../plugins/plugin-keyval/README.md) | `@buntime/plugin-keyval` | 30 | Deno KV-like key-value store |

## Execution Order

Plugins run in priority order (lower = earlier):

1. **Metrics** (0) - Collects request metrics
2. **Proxy** (5) - Short-circuits proxy requests
3. **AuthN** (10) - Validates tokens, injects identity
4. **Gateway** (15) - Rate limits, checks cache
5. **AuthZ** (20) - Enforces access policies
6. **Durable** (25) - Manages stateful actors
7. **KeyVal** (30) - Key-value storage

## Configuration

Plugins are configured in `buntime.jsonc`:

```jsonc
{
  "required": ["@buntime/plugin-metrics", "@buntime/plugin-database"],
  "plugins": [
    "@buntime/plugin-metrics",
    ["@buntime/plugin-database", {
      "adapters": [
        { "type": "libsql", "default": true, "urls": ["http://localhost:8880"] },
        { "type": "sqlite", "url": "file:./auth.db" }
      ]
    }],
    ["@buntime/plugin-proxy", { "rules": [...] }],
    ["@buntime/plugin-authn", { "database": "sqlite", ... }],
    ["@buntime/plugin-gateway", { "rateLimit": { ... } }],
    ["@buntime/plugin-authz", { "policies": [...] }],
    ["@buntime/plugin-durable", { "database": "libsql" }],
    ["@buntime/plugin-keyval", { "database": "libsql" }]
  ]
}
```

### Multiple Adapters

- Each adapter type can appear only once
- One adapter must have `default: true`
- Plugins can specify `database: "libsql" | "sqlite" | ...` to choose adapter
- If not specified, plugins use the default adapter

### Auto-detection

libSQL URLs are auto-detected via environment variables:
- `LIBSQL_URL_0` = Primary (required)
- `LIBSQL_URL_1`, `LIBSQL_URL_2`, ... = Replicas (optional)

## Plugin Routes

**All plugins are mounted under `/p/` prefix** - this is enforced by the runtime and cannot be changed.

### Default Paths

- **Base path**: `/p/{name}` (e.g., `/p/keyval`)
- **Fragment UI**: `/p/{name}/` (React app if plugin has client)
- **API routes**: `/p/{name}/api/*` (REST endpoints)

### Custom Base

You can customize the base via config, but it will always be prefixed with `/p/`:

```jsonc
["@buntime/plugin-database", { "base": "db" }]     // → /p/db
["@buntime/plugin-database", { "base": "/mydb" }]  // → /p/mydb
```

### Examples

- `/p/metrics/api/*` - Metrics endpoints
- `/p/keyval/api/*` - KeyVal REST API
- `/p/health/` - Health dashboard UI
- `/p/logs/` - Logs viewer UI

The `/p/` prefix ensures plugin routes don't conflict with app workers.

## Related SDKs

| SDK | Package | Purpose |
|-----|---------|---------|
| [Durable](../../../packages/durable/README.md) | `@buntime/durable` | Durable actors client for workers |
| [KeyVal](../../../packages/keyval/README.md) | `@buntime/keyval` | KeyVal client for workers |

