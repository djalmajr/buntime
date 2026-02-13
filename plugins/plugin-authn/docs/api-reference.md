# API Reference

Complete reference for the plugin-authn API.

## Base URL

All routes are served under the plugin base path:

```
/auth/api/*
```

## Authentication

Auth plugin routes at `/auth/api/**` and `/auth/login/**` are public by default and do not require authentication.

## Endpoints

### GET /

Redirects based on authentication status.

#### Request

```http
GET /auth/
```

#### Response

- **Authenticated**: Redirects to `/` (home)
- **Not authenticated**: Redirects to `/auth/login`

**Status:** `302 Found`

#### Example

```bash
curl -L http://localhost:8000/auth/
```

---

### GET /api/providers

Returns the list of configured authentication providers. Used by the login UI to dynamically render provider buttons.

#### Request

```http
GET /auth/api/providers
```

#### Response

```json
[
  {
    "id": "email-password",
    "type": "email-password",
    "displayName": "Email",
    "allowSignUp": true
  },
  {
    "id": "keycloak",
    "type": "keycloak",
    "displayName": "Keycloak SSO"
  }
]
```

**Status:** `200 OK`

**Fields:**
- `id`: Provider identifier
- `type`: Provider type (`email-password`, `keycloak`, `auth0`, `okta`, `generic-oidc`)
- `displayName`: Human-readable name for UI rendering
- `allowSignUp`: Whether registration is allowed (email-password only)

#### Example

```bash
curl http://localhost:8000/auth/api/providers
```

---

### ALL /api/auth

### ALL /api/auth/*

Delegates to the [better-auth](https://www.better-auth.com/) handler. These routes handle all authentication flows.

#### better-auth Sub-Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/sign-up/email` | Register with email/password |
| `POST` | `/api/auth/sign-in/email` | Sign in with email/password |
| `POST` | `/api/auth/sign-out` | Sign out (clear session) |
| `GET` | `/api/auth/session` | Get current session |
| `GET` | `/api/auth/sign-in/social` | Initiate social/OIDC sign-in redirect |
| `GET` | `/api/auth/callback/:provider` | OAuth callback handler |

#### Sign Up (Email/Password)

```http
POST /auth/api/auth/sign-up/email
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe"
}
```

**Response:**

```json
{
  "user": {
    "id": "user-abc-123",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2024-01-23T10:00:00.000Z"
  },
  "session": {
    "id": "session-xyz",
    "token": "...",
    "expiresAt": "2024-02-22T10:00:00.000Z"
  }
}
```

**Status:** `200 OK`

**Set-Cookie:** `better-auth.session_token=...; Path=/; HttpOnly; SameSite=Lax`

#### Sign In (Email/Password)

```http
POST /auth/api/auth/sign-in/email
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```

#### Social/OIDC Sign In

```http
GET /auth/api/auth/sign-in/social?provider=keycloak&callbackURL=/auth/api/auth/callback/keycloak
```

Redirects to the provider's authorization endpoint.

#### OAuth Callback

```http
GET /auth/api/auth/callback/keycloak?code=...&state=...
```

Exchanges the authorization code for tokens, creates/updates the user, establishes a session, and redirects to the original page.

#### Examples

```bash
# Register new user
curl -X POST http://localhost:8000/auth/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","name":"John"}'

# Sign in
curl -X POST http://localhost:8000/auth/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Get session
curl http://localhost:8000/auth/api/auth/session \
  -H "Cookie: better-auth.session_token=..."
```

---

### GET /api/session

Returns the current user session.

#### Request

```http
GET /auth/api/session
Cookie: better-auth.session_token=...
```

#### Response (Authenticated)

```json
{
  "user": {
    "id": "user-abc-123",
    "email": "user@example.com",
    "name": "John Doe",
    "image": null,
    "createdAt": "2024-01-23T10:00:00.000Z",
    "updatedAt": "2024-01-23T10:00:00.000Z"
  },
  "session": {
    "id": "session-xyz",
    "userId": "user-abc-123",
    "token": "...",
    "expiresAt": "2024-02-22T10:00:00.000Z"
  }
}
```

#### Response (Not Authenticated)

```json
null
```

**Status:** `200 OK`

#### Example

```bash
curl http://localhost:8000/auth/api/session \
  -H "Cookie: better-auth.session_token=your-session-token"
```

---

### GET /api/logout

Logout with full OIDC provider logout support. Clears the local session and redirects to the OIDC provider's end-session endpoint if available.

#### Request

```http
GET /auth/api/logout?redirect=/
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `redirect` | `string` | URL to redirect after logout | `/` |

#### Response

**With OIDC Provider:**

1. Clears local session (Set-Cookie headers)
2. Redirects (`302`) to OIDC provider's logout URL with `id_token_hint` and `post_logout_redirect_uri`

**Without OIDC Provider:**

1. Clears local session (Set-Cookie headers)
2. Redirects (`302`) to the `redirect` parameter

**Status:** `302 Found`

#### Example

```bash
# Logout and redirect to home
curl -L http://localhost:8000/auth/api/logout

# Logout and redirect to specific page
curl -L "http://localhost:8000/auth/api/logout?redirect=/auth/login"
```

---

### POST /api/logout

Logout with JSON response. Returns the OIDC logout URL for client-side redirection.

#### Request

```http
POST /auth/api/logout
Cookie: better-auth.session_token=...
```

#### Response

```json
{
  "success": true,
  "oidcLogoutUrl": "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/logout?id_token_hint=...&post_logout_redirect_uri=..."
}
```

**Status:** `200 OK`

**Fields:**
- `success`: Whether local session was cleared
- `oidcLogoutUrl`: OIDC provider logout URL (null if no OIDC provider or no id_token)

#### Example

```bash
curl -X POST http://localhost:8000/auth/api/logout \
  -H "Cookie: better-auth.session_token=your-session-token"
```

```javascript
// Client-side logout with OIDC redirect
const res = await fetch("/auth/api/logout", { method: "POST" });
const { oidcLogoutUrl } = await res.json();

if (oidcLogoutUrl) {
  // Redirect to OIDC provider for full logout
  window.location.href = oidcLogoutUrl;
} else {
  // Local-only logout, redirect to login
  window.location.href = "/auth/login";
}
```

---

## SCIM 2.0 Endpoints

When SCIM is enabled (`scim.enabled: true`), the following endpoints are mounted at `/auth/api/scim/v2/*`.

### GET /scim/v2/Users

List users with optional filtering.

#### Request

```http
GET /auth/api/scim/v2/Users?startIndex=1&count=10&filter=userName eq "user@example.com"
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `startIndex` | `number` | 1-based start index | `1` |
| `count` | `number` | Maximum results per page | configured `maxResults` |
| `filter` | `string` | SCIM filter expression | - |

#### Response

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 42,
  "startIndex": 1,
  "itemsPerPage": 10,
  "Resources": [
    {
      "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
      "id": "user-abc-123",
      "userName": "user@example.com",
      "name": {
        "givenName": "John",
        "familyName": "Doe"
      },
      "emails": [
        {
          "value": "user@example.com",
          "primary": true
        }
      ],
      "active": true,
      "meta": {
        "resourceType": "User",
        "created": "2024-01-23T10:00:00.000Z",
        "lastModified": "2024-01-23T10:00:00.000Z"
      }
    }
  ]
}
```

---

### GET /scim/v2/Users/:id

Get a single user by ID.

#### Request

```http
GET /auth/api/scim/v2/Users/user-abc-123
```

#### Response

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "user-abc-123",
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe"
  },
  "active": true
}
```

**Status:** `200 OK`

---

### POST /scim/v2/Users

Create a new user.

#### Request

```http
POST /auth/api/scim/v2/Users
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "newuser@example.com",
  "name": {
    "givenName": "Jane",
    "familyName": "Smith"
  },
  "emails": [
    {
      "value": "newuser@example.com",
      "primary": true
    }
  ],
  "active": true
}
```

**Status:** `201 Created`

---

### PUT /scim/v2/Users/:id

Replace a user entirely.

#### Request

```http
PUT /auth/api/scim/v2/Users/user-abc-123
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "updated@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Updated"
  },
  "active": true
}
```

**Status:** `200 OK`

---

### PATCH /scim/v2/Users/:id

Partial update a user.

#### Request

```http
PATCH /auth/api/scim/v2/Users/user-abc-123
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "replace",
      "path": "name.givenName",
      "value": "Jonathan"
    },
    {
      "op": "replace",
      "path": "active",
      "value": false
    }
  ]
}
```

**Status:** `200 OK`

---

### DELETE /scim/v2/Users/:id

Delete a user.

#### Request

```http
DELETE /auth/api/scim/v2/Users/user-abc-123
```

**Status:** `204 No Content`

---

### POST /scim/v2/Bulk

Execute multiple operations in a single request.

#### Request

```http
POST /auth/api/scim/v2/Bulk
Content-Type: application/scim+json

{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "Operations": [
    {
      "method": "POST",
      "path": "/Users",
      "data": {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "userName": "batch1@example.com"
      }
    },
    {
      "method": "DELETE",
      "path": "/Users/user-old-456"
    }
  ]
}
```

**Status:** `200 OK`

---

## Request Authentication Flow

The `onRequest` hook processes every incoming request in this order:

### 1. Skip Plugin Routes

Requests to `/auth/*` are skipped (handled by the routes above).

### 2. Check Public Routes

Checks internal plugin public routes and worker `publicRoutes` from manifest. If matched, the request continues without authentication.

### 3. API Key Authentication

If `X-API-Key` header is present:

```http
GET /api/some-endpoint
X-API-Key: your-api-key
```

- **Valid key**: Injects `X-Identity` header and continues
- **Invalid key**: Returns `401`

```json
{
  "error": "Invalid API key"
}
```

### 4. Session Cookie Authentication

If `better-auth.session_token` cookie is present:

- **Valid session**: Injects `X-Identity` header and continues
- **Invalid session**: Continues without identity (may be handled by authz)

### 5. No Authentication

If no API key or session cookie:

- **API request** (`Accept: application/json`): Returns `401`
  ```json
  {
    "error": "Unauthorized"
  }
  ```
- **Browser request**: Redirects to login page with return URL
  ```
  302 → /auth/login?redirect=/original/path
  ```

---

## X-Identity Header

When authentication succeeds, the plugin injects an `X-Identity` header:

### Session Identity

```json
{
  "sub": "user-abc-123",
  "roles": ["admin", "user"],
  "groups": ["engineering"],
  "claims": {
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

### API Key Identity

```json
{
  "id": "apikey:GitLab CI/CD",
  "name": "GitLab CI/CD",
  "roles": ["deployer"]
}
```

---

## Errors

### Error Response Format

```json
{
  "error": "Error message"
}
```

### Common Errors

#### 401 Unauthorized

```json
{
  "error": "Unauthorized"
}
```

Cause: No valid session or API key.

#### 401 Invalid API Key

```json
{
  "error": "Invalid API key"
}
```

Cause: `X-API-Key` header present but key not found in configuration.

#### 500 Auth Not Configured

```json
{
  "error": "Auth not configured"
}
```

Cause: Plugin initialization failed (missing database, invalid provider config).

---

## Next Steps

- [Providers](concepts/providers.md) - Authentication provider details
- [Identity Injection](concepts/identity.md) - How X-Identity works
- [SCIM 2.0](concepts/scim.md) - Enterprise user provisioning
- [Configuration](guides/configuration.md) - Complete reference
