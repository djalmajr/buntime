# Configuration

Complete reference for all plugin-authz configuration options.

## Configuration Methods

### 1. manifest.yaml

Static plugin configuration:

```yaml
# plugins/plugin-authz/manifest.yaml
name: "@buntime/plugin-authz"
base: "/authz"
enabled: true
injectBase: true

dependencies:
  - "@buntime/plugin-authn"

entrypoint: dist/client/index.html
pluginEntry: dist/plugin.js

combiningAlgorithm: deny-overrides
defaultEffect: deny
store: memory

excludePaths:
  - ".*\\.(js|css|woff2?|png|svg|ico|json)$"
  - "/health"
  - "/public/.*"

policySeed:
  enabled: true
  onlyIfEmpty: true
  environments: ["*"]
  policies:
    - id: admin-full-access
      name: Admin Full Access
      effect: permit
      priority: 100
      subjects:
        - role: admin
      resources:
        - path: "/**"
      actions:
        - method: "*"
```

### 2. Plugin Code

Override via the plugin factory function:

```typescript
import authzPlugin from "@buntime/plugin-authz";

export default authzPlugin({
  combiningAlgorithm: "first-applicable",
  defaultEffect: "deny",
  store: "file",
  path: "./policies.json",
  excludePaths: ["/health", "/public/.*"],
  policySeed: {
    enabled: true,
    onlyIfEmpty: true,
    policies: [
      {
        id: "admin-all",
        effect: "permit",
        subjects: [{ role: "admin" }],
        resources: [{ path: "/**" }],
        actions: [{ method: "*" }],
      },
    ],
  },
});
```

## Configuration Options

### combiningAlgorithm

Policy combining algorithm used by the PDP to resolve multiple matching policies into a single decision.

- **Type:** `"deny-overrides" | "permit-overrides" | "first-applicable"`
- **Default:** `"deny-overrides"`

**Options:**

| Value | Description |
|-------|-------------|
| `deny-overrides` | Any DENY wins over PERMIT (most restrictive) |
| `permit-overrides` | Any PERMIT wins over DENY (most permissive) |
| `first-applicable` | First matching policy by priority decides |

**Example:**
```yaml
combiningAlgorithm: deny-overrides
```

See [Combining Algorithms](../concepts/combining-algorithms.md) for details.

### defaultEffect

Default effect when no policies match the evaluation context.

- **Type:** `"permit" | "deny"`
- **Default:** `"deny"`

**Example:**
```yaml
defaultEffect: deny
```

**Recommendation:** Always use `"deny"` (closed-world assumption). A value of `"permit"` means any request not covered by a policy is allowed.

### store

Policy storage backend.

- **Type:** `"memory" | "file"`
- **Default:** `"memory"`

**Options:**

#### memory

Policies are stored in an in-memory Map. Fast, but policies are lost on restart unless seeded.

```yaml
store: memory
```

#### file

Policies are persisted to a JSON file. Policies survive restarts.

```yaml
store: file
path: ./policies.json
```

**File format:**
```json
{
  "policies": [
    {
      "id": "admin-full-access",
      "effect": "permit",
      "subjects": [{ "role": "admin" }],
      "resources": [{ "path": "/**" }],
      "actions": [{ "method": "*" }]
    }
  ]
}
```

Or as a plain array:
```json
[
  {
    "id": "admin-full-access",
    "effect": "permit",
    "subjects": [{ "role": "admin" }],
    "resources": [{ "path": "/**" }],
    "actions": [{ "method": "*" }]
  }
]
```

### path

File path for the file-based store. Only used when `store: file`.

- **Type:** `string`
- **Default:** none (required when `store: file`)

**Example:**
```yaml
store: file
path: ./policies.json
```

**Behavior:**
- If file does not exist at startup, PAP starts empty
- File is created on first write (policy creation/update/delete)
- File is overwritten on every write operation

### excludePaths

Paths that skip authorization entirely (no policy evaluation). Matched using JavaScript regex patterns.

- **Type:** `string[]`
- **Default:** `[]`

**Example:**
```yaml
excludePaths:
  - ".*\\.(js|css|woff2?|png|svg|ico|json)$"
  - "/health"
  - "/public/.*"
  - "/auth/.*"
```

**Pattern matching:**
- Standard JavaScript regex syntax
- Tested against the full URL pathname
- Double-escape backslashes in YAML (`\\` for `\`)

**Common patterns:**

| Pattern | Description |
|---------|-------------|
| `".*\\.(js\|css\|woff2?\|png\|svg\|ico\|json)$"` | Static assets |
| `"/health"` | Health check endpoint |
| `"/public/.*"` | All public paths |
| `"/auth/.*"` | Authentication routes |
| `"/_/.*"` | Internal routes |

### policySeed

Configuration for automatic policy seeding at startup.

- **Type:** `PolicySeedConfig`
- **Default:** none

```typescript
interface PolicySeedConfig {
  enabled?: boolean;           // Default: true
  onlyIfEmpty?: boolean;       // Default: true
  environments?: string[];     // Default: ["*"]
  file?: string;               // Path to JSON seed file
  policies?: Policy[];         // Inline policies
}
```

#### policySeed.enabled

Enable or disable policy seeding.

- **Type:** `boolean`
- **Default:** `true`

```yaml
policySeed:
  enabled: true
```

#### policySeed.onlyIfEmpty

Only seed if no policies currently exist in the PAP. Prevents overwriting manually created policies.

- **Type:** `boolean`
- **Default:** `true`

```yaml
policySeed:
  onlyIfEmpty: true   # Only seed if PAP is empty
```

Set to `false` to always seed (merge with existing):
```yaml
policySeed:
  onlyIfEmpty: false  # Always apply seed policies
```

#### policySeed.environments

Restrict seeding to specific environments. Uses `NODE_ENV` for comparison.

- **Type:** `string[]`
- **Default:** `["*"]`

```yaml
# Seed in all environments
policySeed:
  environments: ["*"]

# Seed only in development and staging
policySeed:
  environments: ["development", "staging"]

# Seed only in production
policySeed:
  environments: ["production"]
```

#### policySeed.file

Path to a JSON file containing policies to seed.

- **Type:** `string`
- **Default:** none

```yaml
policySeed:
  file: ./seed-policies.json
```

**File format:** Same as the [store file format](#path) (object with `policies` array, or plain array).

File and inline policies are merged (file first, then inline).

#### policySeed.policies

Inline policies to seed directly in the manifest.

- **Type:** `Policy[]`
- **Default:** `[]`

```yaml
policySeed:
  policies:
    - id: admin-full-access
      name: Admin Full Access
      effect: permit
      priority: 100
      subjects:
        - role: admin
      resources:
        - path: "/**"
      actions:
        - method: "*"
```

### policies (deprecated)

Inline policies loaded at startup. Deprecated in favor of `policySeed.policies`.

- **Type:** `Policy[]`
- **Default:** `[]`

```yaml
# Deprecated - use policySeed instead
policies:
  - id: admin-all
    effect: permit
    subjects: [{ role: admin }]
    resources: [{ path: "/**" }]
    actions: [{ method: "*" }]
```

## Manifest Options

These options are standard Buntime manifest fields:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `"@buntime/plugin-authz"` | Plugin identifier |
| `base` | `string` | `"/authz"` | Base path for routes and UI |
| `enabled` | `boolean` | `false` | Enable the plugin |
| `injectBase` | `boolean` | `true` | Inject base path into routes |
| `dependencies` | `string[]` | `["@buntime/plugin-authn"]` | Required plugins |
| `entrypoint` | `string` | `"dist/client/index.html"` | UI SPA entrypoint |
| `pluginEntry` | `string` | `"dist/plugin.js"` | Plugin code entrypoint |
| `menus` | `MenuItem[]` | - | Navigation menu items |

## Configuration Summary

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `combiningAlgorithm` | `string` | `"deny-overrides"` | Policy combining algorithm |
| `defaultEffect` | `"permit" \| "deny"` | `"deny"` | Default when no policies match |
| `store` | `"memory" \| "file"` | `"memory"` | Policy storage backend |
| `path` | `string` | - | File path for file store |
| `excludePaths` | `string[]` | `[]` | Regex patterns for paths to skip |
| `policySeed` | `PolicySeedConfig` | - | Auto-seed policies at startup |
| `policySeed.enabled` | `boolean` | `true` | Enable seeding |
| `policySeed.onlyIfEmpty` | `boolean` | `true` | Only seed if empty |
| `policySeed.environments` | `string[]` | `["*"]` | Allowed environments |
| `policySeed.file` | `string` | - | Seed file path |
| `policySeed.policies` | `Policy[]` | `[]` | Inline seed policies |

## Complete Examples

### Minimal Setup (Memory Store)

```yaml
name: "@buntime/plugin-authz"
enabled: true
combiningAlgorithm: deny-overrides
defaultEffect: deny

policySeed:
  enabled: true
  policies:
    - id: admin-all
      effect: permit
      subjects: [{ role: admin }]
      resources: [{ path: "/**" }]
      actions: [{ method: "*" }]
    - id: user-read
      effect: permit
      subjects: [{ role: user }]
      resources: [{ path: "/api/**" }]
      actions: [{ method: GET }]
```

### File-Based Storage

```yaml
name: "@buntime/plugin-authz"
enabled: true
store: file
path: ./policies.json
combiningAlgorithm: deny-overrides
defaultEffect: deny

excludePaths:
  - ".*\\.(js|css|woff2?|png|svg|ico|json)$"
  - "/health"
```

### Development (Permissive)

```yaml
name: "@buntime/plugin-authz"
enabled: true
combiningAlgorithm: permit-overrides
defaultEffect: permit

excludePaths:
  - ".*\\.(js|css|woff2?|png|svg|ico|json|map)$"
  - "/health"
  - "/public/.*"
  - "/auth/.*"

policySeed:
  enabled: true
  environments: ["development"]
  policies:
    - id: dev-allow-all
      effect: permit
      subjects: []
      resources: [{ path: "/**" }]
      actions: [{ method: "*" }]
```

### Production (Strict)

```yaml
name: "@buntime/plugin-authz"
enabled: true
store: file
path: /data/policies.json
combiningAlgorithm: deny-overrides
defaultEffect: deny

excludePaths:
  - ".*\\.(js|css|woff2?|png|svg|ico|json)$"
  - "/health"

policySeed:
  enabled: true
  onlyIfEmpty: true
  environments: ["production"]
  file: ./seed-policies.json
  policies:
    - id: admin-full-access
      name: Admin Full Access
      effect: permit
      priority: 100
      subjects:
        - role: admin
      resources:
        - path: "/**"
      actions:
        - method: "*"
    - id: user-api-read
      name: Users API Read-Only
      effect: permit
      priority: 90
      subjects:
        - role: user
      resources:
        - path: "/api/**"
      actions:
        - method: GET
    - id: block-admin-panel
      name: Block Admin Panel for Users
      effect: deny
      priority: 200
      subjects:
        - role: user
      resources:
        - path: "/admin/**"
      actions:
        - method: "*"
```

### Priority-Based (First Applicable)

```yaml
name: "@buntime/plugin-authz"
enabled: true
combiningAlgorithm: first-applicable
defaultEffect: deny

policySeed:
  enabled: true
  policies:
    # Priority 1000: Emergency lockdown
    - id: emergency-lockdown
      effect: deny
      priority: 1000
      subjects: []
      resources: [{ path: "/**" }]
      actions: [{ method: "*" }]

    # Priority 100: Admin access
    - id: admin-access
      effect: permit
      priority: 100
      subjects: [{ role: admin }]
      resources: [{ path: "/**" }]
      actions: [{ method: "*" }]

    # Priority 90: User read access
    - id: user-read
      effect: permit
      priority: 90
      subjects: [{ role: user }]
      resources: [{ path: "/api/**" }]
      actions: [{ method: GET }]
```

## Validation

### Test Authorization

```bash
# Test policy evaluation
curl -X POST http://localhost:8000/authz/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "subject": { "id": "test-user", "roles": ["admin"], "groups": [], "claims": {} },
    "resource": { "app": "", "path": "/api/users" },
    "action": { "method": "GET" },
    "environment": { "ip": "127.0.0.1", "time": "2026-02-13T10:00:00Z" }
  }'

# Debug a decision
curl -X POST http://localhost:8000/authz/api/explain \
  -H "Content-Type: application/json" \
  -d '{
    "subject": { "id": "test-user", "roles": ["user"], "groups": [], "claims": {} },
    "resource": { "app": "", "path": "/admin/settings" },
    "action": { "method": "POST" },
    "environment": { "ip": "127.0.0.1", "time": "2026-02-13T10:00:00Z" }
  }'

# List all policies
curl http://localhost:8000/authz/api/policies
```

## Next Steps

- [Policy Management](policy-management.md) - Managing policies via API and seed
- [Overview](../concepts/overview.md) - Architecture and components
- [Policies](../concepts/policies.md) - Policy structure deep dive
- [Combining Algorithms](../concepts/combining-algorithms.md) - Algorithm details
