# Buntime Extensions

Runtime extensions for Buntime server. These extend the server functionality with metrics, proxy, gateway, authentication, and authorization.

## Available Extensions

| Extension | Package | Priority | Purpose |
|--------|---------|----------|---------|
| Metrics | `@buntime/metrics` | 0 | Pool metrics, Prometheus format, SSE streaming |
| Proxy | `@buntime/proxy` | 5 | HTTP/WebSocket proxy with path rewriting |
| AuthN | `@buntime/authn` | 10 | JWT/OIDC/Keycloak authentication |
| Gateway | `@buntime/gateway` | 15 | Rate limiting, caching, CORS |
| AuthZ | `@buntime/authz` | 20 | XACML-like policy authorization |

## Extension Execution Order

Extensions run in priority order (lower = earlier):
1. **Metrics** (0) - Collects request metrics
2. **Proxy** (5) - Short-circuits proxy requests
3. **AuthN** (10) - Validates tokens, injects identity
4. **Gateway** (15) - Rate limits, checks cache
5. **AuthZ** (20) - Enforces access policies

## @buntime/metrics

Provides metrics endpoints for monitoring.

**Endpoints:**
- `GET /_/metrics/` - JSON metrics
- `GET /_/metrics/prometheus` - Prometheus format
- `GET /_/metrics/sse` - Server-Sent Events stream
- `GET /_/metrics/stats` - Full stats (pool + workers)

**Config:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prometheus` | `boolean` | `true` | Enable Prometheus endpoint |
| `sseInterval` | `number` | `1000` | SSE update interval (ms) |

**Usage:**

```typescript
export default {
  plugins: [
    ["@buntime/metrics", {
      sseInterval: 2000,
    }],
  ],
}
```

## @buntime/proxy

HTTP and WebSocket proxy with regex-based routing.

**Features:**
- Regex path matching with capture groups
- Path rewriting (`$1`, `$2`, etc.)
- Environment variable substitution (`${API_URL}`)
- WebSocket proxy support
- Custom headers

**Config:**

| Option | Type | Description |
|--------|------|-------------|
| `rules` | `ProxyRule[]` | Array of proxy rules |

**ProxyRule:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pattern` | `string` | required | Regex pattern to match |
| `target` | `string` | required | Target URL (supports `${ENV}`) |
| `rewrite` | `string` | - | Path rewrite with capture groups |
| `changeOrigin` | `boolean` | `false` | Change Host/Origin headers |
| `secure` | `boolean` | `true` | Verify SSL certificates |
| `headers` | `object` | - | Additional headers |
| `ws` | `boolean` | `true` | Enable WebSocket proxy |

**Usage:**

```typescript
export default {
  plugins: [
    ["@buntime/proxy", {
      rules: [
        {
          pattern: "^/api/v(\\d+)/(.*)",
          target: "${API_URL}",
          rewrite: "/version/$1/$2",
          changeOrigin: true,
        },
        {
          pattern: "^/ws/(.*)",
          target: "ws://realtime:8080",
          rewrite: "/$1",
        },
      ],
    }],
  ],
}
```

## @buntime/authn

JWT/OIDC authentication with Keycloak support.

**Features:**
- Keycloak, OIDC, and simple JWT providers
- JWKS caching
- Token validation and expiration
- Identity injection via `X-Identity` header

**Endpoints:**
- `GET /_/authn/well-known` - Provider info
- `POST /_/authn/introspect` - Token introspection

**Config:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `"keycloak" \| "oidc" \| "jwt"` | `"keycloak"` | Auth provider |
| `issuer` | `string` | - | Issuer URL (supports `${ENV}`) |
| `realm` | `string` | - | Keycloak realm (supports `${ENV}`) |
| `clientId` | `string` | - | OIDC client ID |
| `clientSecret` | `string` | - | OIDC client secret |
| `secret` | `string` | - | JWT secret (for `jwt` provider) |
| `algorithm` | `"HS256" \| "RS256"` | `"HS256"` | JWT algorithm |
| `optional` | `boolean` | `false` | Allow unauthenticated requests |
| `headerName` | `string` | `"Authorization"` | Token header |
| `tokenPrefix` | `string` | `"Bearer"` | Token prefix |
| `excludePaths` | `string[]` | `[]` | Paths to skip (regex) |
| `jwksCacheTtl` | `number` | `3600` | JWKS cache TTL (seconds) |

**Identity Structure:**

```typescript
interface Identity {
  sub: string;        // User ID
  email?: string;     // User email
  name?: string;      // Display name
  roles: string[];    // User roles
  groups: string[];   // User groups
  claims: object;     // All token claims
}
```

**Usage:**

```typescript
export default {
  plugins: [
    ["@buntime/authn", {
      provider: "keycloak",
      issuer: "${KEYCLOAK_URL}",
      realm: "${KEYCLOAK_REALM}",
      excludePaths: ["/health", "/public/.*"],
    }],
  ],
}
```

## @buntime/gateway

API gateway features: rate limiting, caching, CORS.

**Features:**
- Token bucket rate limiting
- Response caching (in-memory)
- CORS handling with preflight

**Endpoints:**
- `GET /_/gateway/stats` - Gateway stats
- `POST /_/gateway/cache/invalidate` - Invalidate cache

**Config:**

| Option | Type | Description |
|--------|------|-------------|
| `rateLimit` | `RateLimitConfig` | Rate limiting config |
| `cache` | `CacheConfig` | Response caching config |
| `cors` | `CorsConfig` | CORS config |

**RateLimitConfig:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requests` | `number` | `100` | Max requests per window |
| `window` | `string` | `"1m"` | Time window (`"30s"`, `"1m"`, `"1h"`) |
| `keyBy` | `"ip" \| "user" \| Function` | `"ip"` | Rate limit key |
| `excludePaths` | `string[]` | `[]` | Paths to skip (regex) |

**CacheConfig:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ttl` | `number` | `60` | Cache TTL (seconds) |
| `methods` | `string[]` | `["GET"]` | Methods to cache |
| `maxEntries` | `number` | `1000` | Max cache entries |
| `excludePaths` | `string[]` | `[]` | Paths to skip (regex) |

**CorsConfig:**

| Option | Type | Description |
|--------|------|-------------|
| `origin` | `string \| string[]` | Allowed origins (`"*"` for all) |
| `methods` | `string[]` | Allowed methods |
| `allowedHeaders` | `string[]` | Allowed headers |
| `exposedHeaders` | `string[]` | Exposed headers |
| `credentials` | `boolean` | Allow credentials |
| `maxAge` | `number` | Preflight cache (seconds) |

**Usage:**

```typescript
export default {
  plugins: [
    ["@buntime/gateway", {
      rateLimit: {
        requests: 100,
        window: "1m",
        keyBy: "ip",
      },
      cache: {
        ttl: 300,
        methods: ["GET"],
      },
      cors: {
        origin: "*",
        credentials: false,
      },
    }],
  ],
}
```

## @buntime/authz

XACML-like policy-based authorization.

**Architecture:**
- **PEP** (Policy Enforcement Point) - Intercepts requests, applies decisions
- **PDP** (Policy Decision Point) - Evaluates policies, returns PERMIT/DENY
- **PAP** (Policy Administration Point) - CRUD for policies

**Endpoints:**
- `GET /_/authz/policies` - List policies
- `GET /_/authz/policies/:id` - Get policy
- `POST /_/authz/policies` - Create/update policy
- `DELETE /_/authz/policies/:id` - Delete policy
- `POST /_/authz/evaluate` - Evaluate context
- `POST /_/authz/explain` - Debug decision

**Requires:** `@buntime/authn` (for identity)

**Config:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `combiningAlgorithm` | `"deny-overrides" \| "permit-overrides" \| "first-applicable"` | `"deny-overrides"` | Policy combining |
| `defaultEffect` | `"permit" \| "deny"` | `"deny"` | Default when no match |
| `store` | `"memory" \| "file"` | `"memory"` | Policy storage |
| `path` | `string` | - | File path for file store |
| `policies` | `Policy[]` | `[]` | Inline policies |
| `excludePaths` | `string[]` | `[]` | Paths to skip (regex) |

**Policy Structure:**

```typescript
interface Policy {
  id: string;
  name?: string;
  effect: "permit" | "deny";
  priority?: number;
  subjects: SubjectMatch[];   // Who
  resources: ResourceMatch[]; // What
  actions: ActionMatch[];     // How
  conditions?: Condition[];   // When
}

// Match any role
{ role: "admin" }

// Match any path
{ path: "/api/*" }

// Match any method
{ method: "*" }
```

**Usage:**

```typescript
export default {
  plugins: [
    ["@buntime/authn", { ... }],
    ["@buntime/authz", {
      store: "file",
      path: "./policies.json",
      policies: [
        {
          id: "admin-all",
          effect: "permit",
          subjects: [{ role: "admin" }],
          resources: [{ path: "*" }],
          actions: [{ method: "*" }],
        },
        {
          id: "user-read",
          effect: "permit",
          subjects: [{ role: "user" }],
          resources: [{ path: "/api/*" }],
          actions: [{ method: "GET" }],
        },
      ],
    }],
  ],
}
```

## Full Configuration Example

```typescript
// buntime.config.ts
export default {
  plugins: [
    // Metrics first
    ["@buntime/metrics", {
      sseInterval: 1000,
    }],

    // Proxy for API gateway
    ["@buntime/proxy", {
      rules: [
        { pattern: "^/api/(.*)", target: "${API_URL}", rewrite: "/$1" },
      ],
    }],

    // Authentication
    ["@buntime/authn", {
      provider: "keycloak",
      issuer: "${KEYCLOAK_URL}",
      realm: "${KEYCLOAK_REALM}",
      excludePaths: ["/health"],
    }],

    // Gateway (rate limit, cache, CORS)
    ["@buntime/gateway", {
      rateLimit: { requests: 100, window: "1m" },
      cors: { origin: "*" },
    }],

    // Authorization
    ["@buntime/authz", {
      policies: [
        { id: "admin", effect: "permit", subjects: [{ role: "admin" }], resources: [{ path: "*" }], actions: [{ method: "*" }] },
      ],
    }],
  ],
}
```
