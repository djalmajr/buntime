# @buntime/authz

XACML-like policy-based authorization extension for Buntime server.

## Architecture

- **PEP** (Policy Enforcement Point) - Intercepts requests, applies decisions
- **PDP** (Policy Decision Point) - Evaluates policies, returns PERMIT/DENY
- **PAP** (Policy Administration Point) - CRUD for policies

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /_/authz/policies` | List policies |
| `GET /_/authz/policies/:id` | Get policy |
| `POST /_/authz/policies` | Create/update policy |
| `DELETE /_/authz/policies/:id` | Delete policy |
| `POST /_/authz/evaluate` | Evaluate context |
| `POST /_/authz/explain` | Debug decision |

## Requirements

Requires `@buntime/authn` extension (for identity).

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `combiningAlgorithm` | `"deny-overrides" \| "permit-overrides" \| "first-applicable"` | `"deny-overrides"` | Policy combining |
| `defaultEffect` | `"permit" \| "deny"` | `"deny"` | Default when no match |
| `store` | `"memory" \| "file"` | `"memory"` | Policy storage |
| `path` | `string` | - | File path for file store |
| `policies` | `Policy[]` | `[]` | Inline policies |
| `excludePaths` | `string[]` | `[]` | Paths to skip (regex) |

## Policy Structure

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

// Match examples
{ role: "admin" }      // Subject match
{ path: "/api/*" }     // Resource match
{ method: "*" }        // Action match
```

## Usage

```typescript
// buntime.config.ts
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

## Priority

**20** - Enforces access policies.
