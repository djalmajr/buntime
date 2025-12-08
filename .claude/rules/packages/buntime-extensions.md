# Buntime Extensions

Runtime extensions for Buntime server. Located in `packages/` folder.

## Available Extensions

| Extension | Package | Priority | Purpose |
|-----------|---------|----------|---------|
| [Metrics](../../../packages/metrics/README.md) | `@buntime/metrics` | 0 | Pool metrics, Prometheus, SSE |
| [Proxy](../../../packages/proxy/README.md) | `@buntime/proxy` | 5 | HTTP/WebSocket proxy |
| [AuthN](../../../packages/authn/README.md) | `@buntime/authn` | 10 | JWT/OIDC/Keycloak auth |
| [Gateway](../../../packages/gateway/README.md) | `@buntime/gateway` | 15 | Rate limiting, caching, CORS |
| [AuthZ](../../../packages/authz/README.md) | `@buntime/authz` | 20 | XACML-like policies |
| [Durable Objects](../../../packages/durable-objects/README.md) | `@buntime/durable-objects` | 25 | Stateful singletons |

## Execution Order

Extensions run in priority order (lower = earlier):

1. **Metrics** (0) - Collects request metrics
2. **Proxy** (5) - Short-circuits proxy requests
3. **AuthN** (10) - Validates tokens, injects identity
4. **Gateway** (15) - Rate limits, checks cache
5. **AuthZ** (20) - Enforces access policies
6. **Durable Objects** (25) - Manages stateful instances

## Configuration

Extensions are configured in `buntime.jsonc`:

```jsonc
{
  "required": ["@buntime/metrics"],
  "plugins": [
    "@buntime/metrics",
    ["@buntime/proxy", { "rules": [...] }],
    ["@buntime/authn", { "provider": "keycloak", ... }],
    ["@buntime/gateway", { "rateLimit": { ... } }],
    ["@buntime/authz", { "policies": [...] }]
  ]
}
```

## Extension Routes

Each extension mounts its routes at `/_/{extension-name}/*`:

- `/_/metrics/*` - Metrics endpoints
- `/_/authn/*` - Authentication endpoints
- `/_/gateway/*` - Gateway endpoints
- `/_/authz/*` - Authorization endpoints
- `/_/durable-objects/*` - Durable Objects management

## Related

- [Durable Objects SDK](../../../packages/durable-objects-sdk/README.md) - Client library for workers
