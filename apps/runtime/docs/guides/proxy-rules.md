# Proxy Rules Guide

This guide covers how to configure and manage proxy rules in Buntime using the `@buntime/plugin-proxy`.

## Overview

The proxy plugin allows you to create reverse proxy rules that forward requests to external services. This is useful for:

- API aggregation (multiple backends behind a single domain)
- Legacy service integration
- Development environments (proxy to local services)
- CORS bypass for external APIs

## Prerequisites

The `@buntime/plugin-proxy` must be loaded. Verify with:

```bash
curl -s https://buntime.home/_/api/plugins/loaded \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.name | contains("proxy"))'
```

## API Endpoints

All proxy management endpoints are under `/redirects/api/`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/redirects/api/rules` | List all rules |
| POST | `/redirects/api/rules` | Create new rule |
| PUT | `/redirects/api/rules/:id` | Update existing rule |
| DELETE | `/redirects/api/rules/:id` | Delete rule |

## Rule Schema

```json
{
  "name": "My API Proxy",
  "pattern": "^/api(/.*)?$",
  "target": "https://backend.example.com",
  "rewrite": "/api$1",
  "changeOrigin": true,
  "ws": true,
  "publicRoutes": {
    "GET": ["/api/public/**"],
    "POST": ["/api/webhook"]
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name |
| `pattern` | string | Yes | Regex pattern to match request paths |
| `target` | string | Yes | Target URL to proxy to |
| `rewrite` | string | No | Path rewrite pattern (use `$1`, `$2` for capture groups) |
| `changeOrigin` | boolean | No | Change `Host` header to target host (default: true) |
| `ws` | boolean | No | Enable WebSocket proxying (default: true) |
| `publicRoutes` | object | No | Routes that bypass authentication |

### Pattern Examples

```javascript
// Match /api and all subpaths
"^/api(/.*)?$"     // Matches: /api, /api/users, /api/users/123

// Match specific path
"^/legacy-api(/.*)?$"  // Matches: /legacy-api/endpoint

// Match with version
"^/v1/api(/.*)?$"  // Matches: /v1/api/resource
```

### Rewrite Examples

```javascript
// Keep path as-is
pattern: "^/api(/.*)?$"
rewrite: "/api$1"
// /api/users → /api/users

// Strip prefix
pattern: "^/backend(/.*)?$"
rewrite: "$1"
// /backend/users → /users

// Add prefix
pattern: "^/api(/.*)?$"
rewrite: "/v2/api$1"
// /api/users → /v2/api/users
```

## Creating Rules

### Basic Rule

```bash
curl -X POST https://buntime.home/redirects/api/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Backend API",
    "pattern": "^/api(/.*)?$",
    "target": "https://api.example.com",
    "rewrite": "/api$1",
    "changeOrigin": true
  }'
```

### Rule with Public Routes

Some endpoints may need to bypass authentication (e.g., health checks, webhooks):

```bash
curl -X POST https://buntime.home/redirects/api/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "API with Public Endpoints",
    "pattern": "^/api(/.*)?$",
    "target": "https://api.example.com",
    "rewrite": "/api$1",
    "changeOrigin": true,
    "publicRoutes": {
      "GET": ["/api/config/**", "/api/health"],
      "POST": ["/api/webhook"]
    }
  }'
```

## Listing Rules

```bash
curl -s https://buntime.home/redirects/api/rules \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {name, pattern, target}'
```

**Output:**

```json
{
  "name": "Backend API",
  "pattern": "^/api(/.*)?$",
  "target": "https://api.example.com"
}
{
  "name": "Legacy Service",
  "pattern": "^/legacy(/.*)?$",
  "target": "http://legacy.internal:8080"
}
```

## Updating Rules

```bash
# Get the rule ID first
RULE_ID=$(curl -s https://buntime.home/redirects/api/rules \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[] | select(.name == "Backend API") | .id')

# Update the rule
curl -X PUT "https://buntime.home/redirects/api/rules/$RULE_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: https://buntime.home" \
  -d '{
    "name": "Backend API",
    "pattern": "^/api(/.*)?$",
    "target": "https://new-api.example.com",
    "rewrite": "/v2/api$1"
  }'
```

## Deleting Rules

```bash
curl -X DELETE "https://buntime.home/redirects/api/rules/$RULE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: https://buntime.home"
```

## Complete Example: Multi-Service Setup

Setting up proxy rules for a micro-frontend architecture:

```bash
TOKEN="your-jwt-token"
BASE_URL="https://buntime.home"

# 1. Main API
curl -X POST $BASE_URL/redirects/api/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Front Manager API",
    "pattern": "^/api(/.*)?$",
    "target": "https://backend.example.com",
    "rewrite": "/api$1",
    "changeOrigin": true,
    "publicRoutes": {
      "GET": ["/api/config/**"]
    }
  }'

# 2. User Service
curl -X POST $BASE_URL/redirects/api/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "User Service API",
    "pattern": "^/user-service(/.*)?$",
    "target": "https://users.example.com",
    "rewrite": "/user-service$1",
    "changeOrigin": true
  }'

# 3. Kanban Frontend (micro-frontend)
curl -X POST $BASE_URL/redirects/api/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Kanban Frontend",
    "pattern": "^/hyper-kanban-front(/.*)?$",
    "target": "https://kanban.example.com",
    "rewrite": "/hyper-kanban-front$1",
    "changeOrigin": true
  }'

# 4. Kanban API
curl -X POST $BASE_URL/redirects/api/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Kanban API",
    "pattern": "^/hyper-kanban-api(/.*)?$",
    "target": "https://kanban-api.example.com",
    "rewrite": "/hyper-kanban-api$1",
    "changeOrigin": true
  }'

# 5. Edge Runtime (with public translation API)
curl -X POST $BASE_URL/redirects/api/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Edge Runtime",
    "pattern": "^/a(/.*)?$",
    "target": "https://edge.example.com",
    "rewrite": "/a$1",
    "changeOrigin": true,
    "publicRoutes": {
      "GET": ["/a/translate-api/**"]
    }
  }'

# Verify all rules
curl -s $BASE_URL/redirects/api/rules \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {name, pattern}'
```

## Persistence

Proxy rules are stored in the KeyVal plugin's database (typically LibSQL). Rules persist across pod restarts if using a persistent volume for the database.

## Troubleshooting

### Rule Not Working

1. **Check pattern**: Ensure the regex pattern matches your request path.

2. **Test with curl**:
   ```bash
   curl -v https://buntime.home/api/test \
     -H "Authorization: Bearer $TOKEN"
   ```

3. **Check logs**:
   ```bash
   kubectl -n zomme logs -f $POD | grep -i proxy
   ```

### Authentication Issues

- Ensure the `Authorization` header is included
- For CSRF-protected endpoints (POST, PUT, DELETE), include the `Origin` header
- Check if the route should be in `publicRoutes`

### Pattern Conflicts

If multiple rules match the same path, the first matching rule wins. Order rules from most specific to least specific.

## Security Considerations

1. **Target Validation**: Only proxy to trusted targets
2. **Public Routes**: Minimize public routes to reduce attack surface
3. **Internal Services**: Use internal DNS names for services within the cluster
4. **Headers**: `changeOrigin: true` modifies the Host header - be aware of security implications
