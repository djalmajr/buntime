# @buntime/authn

JWT/OIDC authentication extension for Buntime runner.

## Features

- Keycloak, OIDC, and simple JWT providers
- JWKS caching
- Token validation and expiration
- Identity injection via `X-Identity` header

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /_/authn/well-known` | Provider info |
| `POST /_/authn/introspect` | Token introspection |

## Configuration

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

## Identity Structure

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

## Usage

```typescript
// buntime.config.ts
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

## Priority

**10** - Validates tokens and injects identity.
