# Future: API Keys & Authentication

This document describes the API key system that was previously implemented but removed during the runtime simplification. If authentication becomes necessary in the future, this serves as a reference for re-implementation.

## Previous Architecture

### Database Schema

```sql
CREATE TABLE api_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,    -- bcrypt hash
  key_prefix      TEXT NOT NULL,           -- first 12 chars (btk_xxxx...)

  -- Permissions
  role            TEXT NOT NULL,           -- 'admin' | 'editor' | 'viewer' | 'custom'
  permissions     TEXT DEFAULT '[]',       -- JSON array

  -- Metadata
  created_by      INTEGER,
  created_at      INTEGER DEFAULT (unixepoch()),
  expires_at      INTEGER,
  last_used_at    INTEGER,
  revoked_at      INTEGER,

  -- Audit
  description     TEXT,

  FOREIGN KEY (created_by) REFERENCES api_keys(id)
);

CREATE TABLE audit_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       INTEGER DEFAULT (unixepoch()),
  actor_id        INTEGER,
  actor_name      TEXT NOT NULL,
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     TEXT,
  resource_name   TEXT,
  details         TEXT,                    -- JSON
  ip_address      TEXT,
  user_agent      TEXT
);
```

### Key Format

- Prefix: `btk_` (Buntime Key)
- Random part: 32 chars (base62)
- Example: `btk_AbCdEfGhIjKlMnOpQrStUvWxYz012345`
- Display prefix: `btk_AbCd...`

### Role Hierarchy

| Role | Permissions | Can Create |
|------|-------------|------------|
| root | * (all) | admin, editor, viewer, custom |
| admin | * (all) | editor, viewer, custom |
| editor | apps/plugins install/remove/config | - |
| viewer | read-only | - |
| custom | specific permissions | - |

### Permissions

```typescript
type Permission =
  | "apps:install" | "apps:read" | "apps:remove"
  | "config:read" | "config:write"
  | "keys:create" | "keys:read" | "keys:revoke"
  | "plugins:config" | "plugins:disable" | "plugins:enable"
  | "plugins:install" | "plugins:read" | "plugins:remove"
  | "workers:read" | "workers:restart";
```

### API Endpoints (Previous)

```
GET    /api/keys           - List API keys
POST   /api/keys           - Create key
GET    /api/keys/:id       - Get key details
PUT    /api/keys/:id       - Update key
DELETE /api/keys/:id       - Revoke key
POST   /api/keys/:id/clone - Clone key
GET    /api/keys/meta      - Get roles/permissions
GET    /api/keys/audit     - Get audit logs
```

### Authentication Flow

1. Request includes `Authorization: Bearer btk_xxx` header
2. Extract key prefix, look up in database
3. Verify full key against bcrypt hash
4. Check: not revoked, not expired
5. Return validated key info for permission checks

### Root Key

Environment variable `ROOT_KEY` provides full admin access without database lookup. Useful for CLI tools and initial setup.

## Why It Was Removed

1. **Complexity**: Required LibSQL database running before runtime startup
2. **Bootstrap problem**: Database itself could be a plugin, creating circular dependency
3. **Overkill**: For most use cases, simple deployment without auth is sufficient
4. **Testing friction**: Harder to test and develop locally

## When to Re-implement

Consider adding authentication back if:

- Multi-tenant deployment needed
- External API access required
- Audit trail is mandatory (compliance)
- Fine-grained permissions needed

## Alternative Approaches

1. **Reverse proxy auth**: Use nginx/Caddy with basic auth or OAuth
2. **Plugin-based**: Create `plugin-admin` that adds auth to specific routes
3. **File-based keys**: Store keys in JSON file instead of database
4. **Environment-based**: Use env vars for simple key validation

## Files That Were Removed

- `runtime/src/libs/database.ts` - LibSQL client and migrations
- `runtime/src/libs/api-keys.ts` - Key management functions
- `runtime/src/libs/audit.ts` - Audit logging
- `runtime/src/libs/hono-context.ts` - Typed context for validated key
- `runtime/src/routes/keys.ts` - API key endpoints
- `runtime/src/routes/config.ts` - Plugin config management (used database)
