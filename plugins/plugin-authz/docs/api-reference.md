# API Reference

Complete reference for the plugin-authz API.

## Base URL

All routes are served under the plugin base path:

```
/authz/api/*
```

## Authentication

AuthZ API routes inherit the authentication context from `@buntime/plugin-authn`. The `X-Identity` header is injected by the authn plugin and consumed by authz for policy evaluation.

## Endpoints

### GET /api/policies

List all policies stored in the PAP.

#### Request

```http
GET /authz/api/policies
```

#### Response

```json
[
  {
    "id": "admin-full-access",
    "name": "Admin Full Access",
    "description": "Allow admin role full access",
    "effect": "permit",
    "priority": 100,
    "subjects": [{ "role": "admin" }],
    "resources": [{ "path": "/**" }],
    "actions": [{ "method": "*" }]
  },
  {
    "id": "users-read-only",
    "name": "Users Read-Only",
    "description": "Allow user role read-only access to API",
    "effect": "permit",
    "priority": 90,
    "subjects": [{ "role": "user" }],
    "resources": [{ "path": "/api/**" }],
    "actions": [{ "method": "GET" }]
  }
]
```

**Status:** `200 OK`

**Fields (per policy):**
- `id`: Unique policy identifier
- `name`: Human-readable name (optional)
- `description`: Policy description (optional)
- `effect`: `"permit"` or `"deny"`
- `priority`: Evaluation priority, higher first (default: `0`)
- `subjects`: Array of subject matching rules
- `resources`: Array of resource matching rules
- `actions`: Array of action matching rules
- `conditions`: Array of additional conditions (optional)

#### Example

```bash
curl http://localhost:8000/authz/api/policies
```

---

### GET /api/policies/:id

Get a single policy by ID.

#### Request

```http
GET /authz/api/policies/admin-full-access
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Unique policy identifier |

#### Response

```json
{
  "id": "admin-full-access",
  "name": "Admin Full Access",
  "description": "Allow admin role full access",
  "effect": "permit",
  "priority": 100,
  "subjects": [{ "role": "admin" }],
  "resources": [{ "path": "/**" }],
  "actions": [{ "method": "*" }]
}
```

**Status:** `200 OK`

**Error Response (Not Found):**

```json
{
  "error": "Policy not found"
}
```

**Status:** `404 Not Found`

#### Example

```bash
curl http://localhost:8000/authz/api/policies/admin-full-access
```

---

### POST /api/policies

Create or update a policy. If a policy with the same `id` exists, it is replaced.

#### Request

```http
POST /authz/api/policies
Content-Type: application/json

{
  "id": "editors-write-articles",
  "name": "Editors Write Articles",
  "description": "Allow editors to create and update articles",
  "effect": "permit",
  "priority": 80,
  "subjects": [
    { "role": "editor" },
    { "group": "content-team" }
  ],
  "resources": [
    { "path": "/api/articles/**" }
  ],
  "actions": [
    { "method": "POST" },
    { "method": "PUT" }
  ]
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique policy identifier |
| `name` | `string` | No | Human-readable name |
| `description` | `string` | No | Policy description |
| `effect` | `"permit" \| "deny"` | Yes | Policy decision effect |
| `priority` | `number` | No | Evaluation priority (default: `0`) |
| `subjects` | `SubjectMatch[]` | Yes | Who can access |
| `resources` | `ResourceMatch[]` | Yes | What can be accessed |
| `actions` | `ActionMatch[]` | Yes | How it can be accessed |
| `conditions` | `Condition[]` | No | Additional conditions |

#### Response

```json
{
  "id": "editors-write-articles",
  "name": "Editors Write Articles",
  "description": "Allow editors to create and update articles",
  "effect": "permit",
  "priority": 80,
  "subjects": [
    { "role": "editor" },
    { "group": "content-team" }
  ],
  "resources": [
    { "path": "/api/articles/**" }
  ],
  "actions": [
    { "method": "POST" },
    { "method": "PUT" }
  ]
}
```

**Status:** `201 Created`

**Error Response (Invalid Structure):**

```json
{
  "error": "Invalid policy structure"
}
```

**Status:** `400 Bad Request`

**Validation Rules:**
- `id` is required
- `effect` is required
- `subjects` is required (can be empty array for "any subject")
- `resources` is required (can be empty array for "any resource")
- `actions` is required (can be empty array for "any action")

#### Examples

```bash
# Create a basic permit policy
curl -X POST http://localhost:8000/authz/api/policies \
  -H "Content-Type: application/json" \
  -d '{
    "id": "api-read-all",
    "name": "API Read Access",
    "effect": "permit",
    "priority": 50,
    "subjects": [{ "role": "user" }],
    "resources": [{ "path": "/api/**" }],
    "actions": [{ "method": "GET" }]
  }'

# Create a deny policy
curl -X POST http://localhost:8000/authz/api/policies \
  -H "Content-Type: application/json" \
  -d '{
    "id": "block-admin-panel",
    "name": "Block Admin Panel",
    "effect": "deny",
    "priority": 200,
    "subjects": [{ "role": "user" }],
    "resources": [{ "path": "/admin/**" }],
    "actions": [{ "method": "*" }]
  }'

# Create a policy with conditions
curl -X POST http://localhost:8000/authz/api/policies \
  -H "Content-Type: application/json" \
  -d '{
    "id": "business-hours-only",
    "name": "Business Hours Only",
    "effect": "permit",
    "priority": 70,
    "subjects": [{ "role": "user" }],
    "resources": [{ "path": "/api/reports/**" }],
    "actions": [{ "method": "GET" }],
    "conditions": [
      {
        "type": "time",
        "after": "09:00",
        "before": "18:00",
        "dayOfWeek": [1, 2, 3, 4, 5]
      }
    ]
  }'
```

---

### DELETE /api/policies/:id

Delete a policy by ID.

#### Request

```http
DELETE /authz/api/policies/editors-write-articles
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Policy ID to delete |

#### Response

```json
{
  "success": true
}
```

**Status:** `200 OK`

**Error Response (Not Found):**

```json
{
  "error": "Policy not found"
}
```

**Status:** `404 Not Found`

#### Example

```bash
curl -X DELETE http://localhost:8000/authz/api/policies/editors-write-articles
```

---

### POST /api/evaluate

Manually evaluate an authorization context against all stored policies. Returns the PDP decision.

#### Request

```http
POST /authz/api/evaluate
Content-Type: application/json

{
  "subject": {
    "id": "user-123",
    "roles": ["admin"],
    "groups": ["engineering"],
    "claims": {}
  },
  "resource": {
    "app": "dashboard",
    "path": "/api/users"
  },
  "action": {
    "method": "DELETE"
  },
  "environment": {
    "ip": "192.168.1.100",
    "time": "2026-02-13T14:30:00.000Z"
  }
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subject` | `object` | Yes | Who is making the request |
| `subject.id` | `string` | Yes | User identifier |
| `subject.roles` | `string[]` | Yes | User roles |
| `subject.groups` | `string[]` | Yes | User groups |
| `subject.claims` | `object` | No | Custom claims |
| `resource` | `object` | Yes | What is being accessed |
| `resource.app` | `string` | No | Application name |
| `resource.path` | `string` | Yes | Request path |
| `action` | `object` | Yes | How it is being accessed |
| `action.method` | `string` | Yes | HTTP method |
| `action.operation` | `string` | No | Custom operation name |
| `environment` | `object` | No | Environmental context |
| `environment.ip` | `string` | No | Client IP address |
| `environment.time` | `string` | No | ISO datetime |
| `environment.userAgent` | `string` | No | User agent string |

#### Response

```json
{
  "effect": "permit",
  "reason": "Allow admin role full access",
  "matchedPolicy": "admin-full-access"
}
```

**Status:** `200 OK`

**Decision Fields:**
- `effect`: `"permit"`, `"deny"`, `"not_applicable"`, or `"indeterminate"`
- `reason`: Human-readable reason for the decision
- `matchedPolicy`: ID of the policy that produced the decision (if any)

#### Examples

```bash
# Evaluate admin access
curl -X POST http://localhost:8000/authz/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "subject": { "id": "user-1", "roles": ["admin"], "groups": [], "claims": {} },
    "resource": { "app": "", "path": "/api/users" },
    "action": { "method": "DELETE" },
    "environment": { "ip": "127.0.0.1", "time": "2026-02-13T10:00:00Z" }
  }'

# Evaluate regular user access (denied)
curl -X POST http://localhost:8000/authz/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "subject": { "id": "user-2", "roles": ["user"], "groups": [], "claims": {} },
    "resource": { "app": "", "path": "/admin/settings" },
    "action": { "method": "POST" },
    "environment": { "ip": "10.0.0.1", "time": "2026-02-13T10:00:00Z" }
  }'
```

---

### POST /api/explain

Debug a policy decision. Returns the full evaluation context, the final decision, and a summary of all policies that were considered.

#### Request

```http
POST /authz/api/explain
Content-Type: application/json

{
  "subject": {
    "id": "user-456",
    "roles": ["user"],
    "groups": [],
    "claims": {}
  },
  "resource": {
    "app": "",
    "path": "/admin/settings"
  },
  "action": {
    "method": "POST"
  },
  "environment": {
    "ip": "10.0.0.1",
    "time": "2026-02-13T10:00:00.000Z"
  }
}
```

#### Response

```json
{
  "context": {
    "subject": {
      "id": "user-456",
      "roles": ["user"],
      "groups": [],
      "claims": {}
    },
    "resource": {
      "app": "",
      "path": "/admin/settings"
    },
    "action": {
      "method": "POST"
    },
    "environment": {
      "ip": "10.0.0.1",
      "time": "2026-02-13T10:00:00.000Z"
    }
  },
  "decision": {
    "effect": "deny",
    "reason": "No applicable policy"
  },
  "policies": [
    {
      "id": "admin-full-access",
      "name": "Admin Full Access",
      "effect": "permit",
      "priority": 100
    },
    {
      "id": "users-read-only",
      "name": "Users Read-Only",
      "effect": "permit",
      "priority": 90
    }
  ]
}
```

**Status:** `200 OK`

**Response Fields:**
- `context`: The full evaluation context as received
- `decision`: The PDP decision result
  - `effect`: Final effect (`"permit"`, `"deny"`, `"not_applicable"`, `"indeterminate"`)
  - `reason`: Explanation for the decision
  - `matchedPolicy`: Policy ID that produced the decision (if any)
- `policies`: Summary of all policies in the store
  - `id`: Policy identifier
  - `name`: Policy name
  - `effect`: Policy effect
  - `priority`: Policy priority

#### Example

```bash
curl -X POST http://localhost:8000/authz/api/explain \
  -H "Content-Type: application/json" \
  -d '{
    "subject": { "id": "user-456", "roles": ["user"], "groups": [], "claims": {} },
    "resource": { "app": "", "path": "/admin/settings" },
    "action": { "method": "POST" },
    "environment": { "ip": "10.0.0.1", "time": "2026-02-13T10:00:00Z" }
  }'
```

---

## PEP Enforcement Response

When the PEP (Policy Enforcement Point) denies a request during the `onRequest` hook, it returns a `403 Forbidden`:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "Forbidden",
  "reason": "No applicable policy",
  "policy": null
}
```

**Fields:**
- `error`: Always `"Forbidden"`
- `reason`: Human-readable reason from the PDP decision
- `policy`: ID of the matched deny policy (or `null` if defaulted)

---

## Errors

### Error Response Format

```json
{
  "error": "Error message"
}
```

### Common Errors

#### 400 Bad Request

```json
{
  "error": "Invalid policy structure"
}
```

Cause: Missing required fields in policy creation (`id`, `effect`, `subjects`, `resources`, `actions`).

#### 403 Forbidden

```json
{
  "error": "Forbidden",
  "reason": "No applicable policy",
  "policy": null
}
```

Cause: PEP enforcement denied the request based on PDP evaluation.

#### 404 Not Found

```json
{
  "error": "Policy not found"
}
```

Cause: Policy with the specified ID does not exist.

#### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

Cause: Unexpected server error during policy evaluation or storage.

---

## TypeScript Types

### Policy

```typescript
interface Policy {
  id: string;
  name?: string;
  description?: string;
  effect: "permit" | "deny";
  priority?: number;
  subjects: SubjectMatch[];
  resources: ResourceMatch[];
  actions: ActionMatch[];
  conditions?: Condition[];
}
```

### SubjectMatch

```typescript
interface SubjectMatch {
  id?: string;
  role?: string;
  group?: string;
  claim?: {
    name: string;
    value: string | number | boolean;
    operator?: "eq" | "neq" | "gt" | "lt" | "contains" | "regex";
  };
}
```

### ResourceMatch

```typescript
interface ResourceMatch {
  app?: string;
  path?: string;
  type?: string;
  owner?: "self";
}
```

### ActionMatch

```typescript
interface ActionMatch {
  method?: string;
  operation?: string;
}
```

### Condition

```typescript
interface Condition {
  type: "time" | "ip" | "custom";
  after?: string;
  before?: string;
  dayOfWeek?: number[];
  cidr?: string;
  allowlist?: string[];
  blocklist?: string[];
  expression?: string;
}
```

### EvaluationContext

```typescript
interface EvaluationContext {
  subject: {
    id: string;
    roles: string[];
    groups: string[];
    claims: Record<string, unknown>;
    [key: string]: unknown;
  };
  resource: {
    app: string;
    path: string;
    [key: string]: unknown;
  };
  action: {
    method: string;
    operation?: string;
  };
  environment: {
    ip: string;
    time: Date;
    userAgent?: string;
    [key: string]: unknown;
  };
}
```

### Decision

```typescript
interface Decision {
  effect: "permit" | "deny" | "not_applicable" | "indeterminate";
  reason?: string;
  matchedPolicy?: string;
}
```

---

## Client SDK Example

### TypeScript

```typescript
class AuthzClient {
  constructor(private baseUrl: string) {}

  async listPolicies(): Promise<Policy[]> {
    const res = await fetch(`${this.baseUrl}/authz/api/policies`);
    return res.json();
  }

  async getPolicy(id: string): Promise<Policy | null> {
    const res = await fetch(`${this.baseUrl}/authz/api/policies/${id}`);
    if (res.status === 404) return null;
    return res.json();
  }

  async createPolicy(policy: Policy): Promise<Policy> {
    const res = await fetch(`${this.baseUrl}/authz/api/policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    return res.json();
  }

  async deletePolicy(id: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/authz/api/policies/${id}`, {
      method: "DELETE",
    });
    return res.ok;
  }

  async evaluate(context: EvaluationContext): Promise<Decision> {
    const res = await fetch(`${this.baseUrl}/authz/api/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });
    return res.json();
  }

  async explain(context: EvaluationContext): Promise<{
    context: EvaluationContext;
    decision: Decision;
    policies: Array<{ id: string; name?: string; effect: string; priority?: number }>;
  }> {
    const res = await fetch(`${this.baseUrl}/authz/api/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });
    return res.json();
  }
}

// Usage
const client = new AuthzClient("http://localhost:8000");

// List all policies
const policies = await client.listPolicies();
console.log(`Found ${policies.length} policies`);

// Create a new policy
await client.createPolicy({
  id: "ops-deploy",
  name: "Ops Deploy Access",
  effect: "permit",
  priority: 85,
  subjects: [{ group: "ops" }],
  resources: [{ path: "/api/deploy/**" }],
  actions: [{ method: "POST" }],
});

// Evaluate a request
const decision = await client.evaluate({
  subject: { id: "user-1", roles: ["admin"], groups: [], claims: {} },
  resource: { app: "", path: "/api/users" },
  action: { method: "DELETE" },
  environment: { ip: "127.0.0.1", time: new Date() },
});
console.log(`Decision: ${decision.effect}`);

// Debug a decision
const explanation = await client.explain({
  subject: { id: "user-2", roles: ["user"], groups: [], claims: {} },
  resource: { app: "", path: "/admin/settings" },
  action: { method: "POST" },
  environment: { ip: "10.0.0.1", time: new Date() },
});
console.log(`Decision: ${explanation.decision.effect}`);
console.log(`Policies evaluated: ${explanation.policies.length}`);
```

---

## Next Steps

- [Overview](concepts/overview.md) - Architecture and components
- [Policies](concepts/policies.md) - Policy structure deep dive
- [Configuration](guides/configuration.md) - Complete configuration reference
- [Policy Management](guides/policy-management.md) - Managing policies via API and seed
