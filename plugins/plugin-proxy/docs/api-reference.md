# API Reference

Complete reference for the plugin-proxy API.

## Base URL

All routes are served under the plugin base path:

```
/redirects/api/*
```

## Authentication

Proxy management API routes are accessible without additional authentication by default, but can be protected via the authn plugin (if enabled).

## Endpoints

### GET /api/rules

Returns all proxy rules (both static and dynamic). Static rules from `manifest.yaml` are marked with `readonly: true`.

#### Request

```http
GET /redirects/api/rules
```

#### Response

```json
[
  {
    "id": "static-0",
    "name": "API Gateway",
    "pattern": "^/api(/.*)?$",
    "target": "https://api.internal:3000",
    "rewrite": "/api$1",
    "changeOrigin": true,
    "secure": true,
    "ws": true,
    "headers": {},
    "publicRoutes": {},
    "readonly": true
  },
  {
    "id": "kv-abc123",
    "name": "External API",
    "pattern": "^/external(/.*)?$",
    "target": "https://external-service.com",
    "rewrite": "$1",
    "changeOrigin": true,
    "secure": true,
    "ws": true,
    "headers": { "X-Forwarded-By": "buntime" },
    "publicRoutes": {
      "GET": ["/external/health"]
    },
    "readonly": false
  }
]
```

**Status:** `200 OK`

**Fields:**
- `id`: Unique rule identifier (auto-generated for static rules as `static-{index}`)
- `name`: Human-readable rule name
- `pattern`: Regex pattern for matching request paths
- `target`: Target URL to proxy to (env vars resolved)
- `rewrite`: Path rewrite template with capture group references (`$1`, `$2`)
- `changeOrigin`: Whether Host/Origin headers are rewritten to target host
- `secure`: Whether SSL certificate verification is enabled
- `ws`: Whether WebSocket proxying is enabled
- `headers`: Additional headers sent with proxied requests
- `publicRoutes`: Routes that bypass authentication (per HTTP method)
- `readonly`: `true` for static rules from manifest, `false` for dynamic rules from KeyVal

#### Examples

```bash
# List all rules
curl http://localhost:8000/redirects/api/rules
```

```typescript
const res = await fetch("/redirects/api/rules");
const rules = await res.json();

const staticRules = rules.filter((r) => r.readonly);
const dynamicRules = rules.filter((r) => !r.readonly);
console.log(`${staticRules.length} static, ${dynamicRules.length} dynamic rules`);
```

---

### POST /api/rules

Creates a new dynamic proxy rule. The rule is persisted in KeyVal and takes effect immediately.

#### Request

```http
POST /redirects/api/rules
Content-Type: application/json

{
  "name": "Backend API",
  "pattern": "^/api(/.*)?$",
  "target": "https://api.example.com",
  "rewrite": "/api$1",
  "changeOrigin": true,
  "secure": true,
  "ws": false,
  "headers": {
    "X-Forwarded-By": "buntime"
  },
  "publicRoutes": {
    "GET": ["/api/health"],
    "POST": ["/api/webhook"]
  }
}
```

**Body Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Human-readable name |
| `pattern` | `string` | Yes | - | Regex pattern to match request paths |
| `target` | `string` | Yes | - | Target URL (supports `${ENV_VAR}` substitution) |
| `rewrite` | `string` | No | - | Path rewrite template (`$1`, `$2`, etc.) |
| `changeOrigin` | `boolean` | No | `false` | Rewrite Host/Origin headers to target host |
| `secure` | `boolean` | No | `true` | Verify SSL certificates on target |
| `ws` | `boolean` | No | `true` | Enable WebSocket proxying for this rule |
| `headers` | `object` | No | `{}` | Additional headers for proxied requests |
| `publicRoutes` | `object` | No | `{}` | Public routes per HTTP method |

#### Response

```json
{
  "id": "kv-abc123",
  "name": "Backend API",
  "pattern": "^/api(/.*)?$",
  "target": "https://api.example.com",
  "rewrite": "/api$1",
  "changeOrigin": true,
  "secure": true,
  "ws": false,
  "headers": { "X-Forwarded-By": "buntime" },
  "publicRoutes": {
    "GET": ["/api/health"],
    "POST": ["/api/webhook"]
  }
}
```

**Status:** `200 OK`

#### Examples

```bash
# Create a simple proxy rule
curl -X POST http://localhost:8000/redirects/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Backend API",
    "pattern": "^/api(/.*)?$",
    "target": "https://api.example.com",
    "rewrite": "/api$1",
    "changeOrigin": true
  }'

# Create a WebSocket proxy rule
curl -X POST http://localhost:8000/redirects/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Realtime WS",
    "pattern": "^/ws(/.*)?$",
    "target": "ws://realtime:8080",
    "rewrite": "$1",
    "ws": true
  }'

# Create a rule with public routes
curl -X POST http://localhost:8000/redirects/api/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Payments API",
    "pattern": "^/payments(/.*)?$",
    "target": "https://payments.internal:4000",
    "rewrite": "$1",
    "changeOrigin": true,
    "publicRoutes": {
      "POST": ["/payments/webhook"],
      "GET": ["/payments/status"]
    }
  }'
```

```typescript
const rule = await fetch("/redirects/api/rules", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "New Service",
    pattern: "^/svc(/.*)?$",
    target: "https://new-service.internal:5000",
    rewrite: "$1",
    changeOrigin: true,
  }),
}).then((r) => r.json());

console.log(`Created rule: ${rule.id}`);
```

---

### PUT /api/rules/:id

Updates an existing dynamic proxy rule. Static rules (from manifest) cannot be updated.

#### Request

```http
PUT /redirects/api/rules/kv-abc123
Content-Type: application/json

{
  "name": "Backend API v2",
  "pattern": "^/api(/.*)?$",
  "target": "https://api-v2.example.com",
  "rewrite": "/v2$1",
  "changeOrigin": true
}
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Rule ID to update |

**Body Parameters:** Same as POST (all fields optional for partial update).

#### Response

```json
{
  "id": "kv-abc123",
  "name": "Backend API v2",
  "pattern": "^/api(/.*)?$",
  "target": "https://api-v2.example.com",
  "rewrite": "/v2$1",
  "changeOrigin": true,
  "secure": true,
  "ws": true,
  "headers": {},
  "publicRoutes": {}
}
```

**Status:** `200 OK`

**Error Response (Static Rule):**

```json
{
  "error": "Cannot modify static rule"
}
```

**Status:** `400 Bad Request`

#### Examples

```bash
# Update a rule's target
curl -X PUT http://localhost:8000/redirects/api/rules/kv-abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "target": "https://api-v2.example.com",
    "rewrite": "/v2$1"
  }'
```

```typescript
await fetch(`/redirects/api/rules/${ruleId}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ target: "https://new-target.example.com" }),
});
```

---

### DELETE /api/rules/:id

Deletes a dynamic proxy rule. Static rules (from manifest) cannot be deleted.

#### Request

```http
DELETE /redirects/api/rules/kv-abc123
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Rule ID to delete |

#### Response

```json
{
  "deleted": true,
  "id": "kv-abc123"
}
```

**Status:** `200 OK`

**Error Response (Static Rule):**

```json
{
  "error": "Cannot delete static rule"
}
```

**Status:** `400 Bad Request`

#### Examples

```bash
# Delete a dynamic rule
curl -X DELETE http://localhost:8000/redirects/api/rules/kv-abc123
```

```typescript
await fetch(`/redirects/api/rules/${ruleId}`, { method: "DELETE" });
```

---

## TypeScript Types

```typescript
interface ProxyRule {
  id?: string;
  name: string;
  pattern: string;
  target: string;
  rewrite?: string;
  changeOrigin?: boolean;
  secure?: boolean;
  ws?: boolean;
  headers?: Record<string, string>;
  publicRoutes?: Record<string, string[]>;
}

interface ProxyRuleResponse extends ProxyRule {
  id: string;
  readonly: boolean;
}
```

---

## Client SDK Example

```typescript
class ProxyClient {
  constructor(private baseUrl: string) {}

  async getRules(): Promise<ProxyRuleResponse[]> {
    const res = await fetch(`${this.baseUrl}/redirects/api/rules`);
    return res.json();
  }

  async createRule(rule: Omit<ProxyRule, "id">): Promise<ProxyRuleResponse> {
    const res = await fetch(`${this.baseUrl}/redirects/api/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule),
    });
    return res.json();
  }

  async updateRule(
    id: string,
    updates: Partial<ProxyRule>,
  ): Promise<ProxyRuleResponse> {
    const res = await fetch(`${this.baseUrl}/redirects/api/rules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return res.json();
  }

  async deleteRule(id: string): Promise<{ deleted: boolean; id: string }> {
    const res = await fetch(`${this.baseUrl}/redirects/api/rules/${id}`, {
      method: "DELETE",
    });
    return res.json();
  }
}

// Usage
const client = new ProxyClient("http://localhost:8000");

// List all rules
const rules = await client.getRules();
console.log(`${rules.length} proxy rules configured`);

// Create a new rule
const newRule = await client.createRule({
  name: "My API",
  pattern: "^/my-api(/.*)?$",
  target: "https://api.example.com",
  rewrite: "$1",
  changeOrigin: true,
});

// Update the rule
await client.updateRule(newRule.id, {
  target: "https://api-v2.example.com",
});

// Delete the rule
await client.deleteRule(newRule.id);
```

---

## Next Steps

- [Overview](concepts/overview.md) - Architecture and request matching flow
- [Proxy Rules](concepts/proxy-rules.md) - Pattern matching and rewriting
- [WebSocket Proxying](concepts/websocket-proxying.md) - WebSocket upgrade and relay
- [Configuration](guides/configuration.md) - Static and dynamic rules setup
