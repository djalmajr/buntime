# Configuration

Complete reference for all plugin-authn configuration options.

## Configuration Methods

### 1. manifest.yaml

Static plugin configuration:

```yaml
# plugins/plugin-authn/manifest.yaml
name: "@buntime/plugin-authn"
base: "/auth"
enabled: true
injectBase: true

dependencies:
  - "@buntime/plugin-database"
optionalDependencies:
  - "@buntime/plugin-proxy"

entrypoint: dist/client/index.html
pluginEntry: dist/plugin.js

loginPath: "/auth/login"
trustedOrigins:
  - "http://localhost:8000"

providers:
  - type: email-password
    displayName: Email
    allowSignUp: true
    requireEmailVerification: false

apiKeys: []

scim:
  enabled: false
  maxResults: 100
  bulkEnabled: true
  maxBulkOperations: 1000
```

### 2. Environment Variables

Provider configuration values support `${ENV_VAR}` substitution:

```bash
# OIDC Provider
KEYCLOAK_URL=https://keycloak.example.com
KEYCLOAK_REALM=myrealm
KEYCLOAK_CLIENT_ID=buntime
KEYCLOAK_CLIENT_SECRET=secret

# API Keys
GITLAB_DEPLOY_KEY=glpat-xxxxxxxxxxxx
MONITORING_KEY=mon-xxxxxxxxxxxx
```

## Configuration Options

### loginPath

Redirect path for unauthenticated browser requests.

- **Type:** `string`
- **Default:** `"/auth/login"`

```yaml
loginPath: "/auth/login"
```

The redirect includes the original URL as a query parameter:
```
/auth/login?redirect=/original/path
```

### trustedOrigins

Origins trusted for CORS and CSRF protection (passed to better-auth).

- **Type:** `string[]`
- **Default:** `[]`

```yaml
trustedOrigins:
  - "http://localhost:8000"
  - "https://buntime.home"
  - "https://app.example.com"
```

### database

Database adapter type to use for auth data storage.

- **Type:** `"sqlite" | "libsql" | "postgres" | "mysql"`
- **Default:** Default adapter from plugin-database

```yaml
database: sqlite
```

If not specified, uses whichever adapter is marked as `default: true` in plugin-database.

### providers

Authentication provider configurations. Multiple providers can be active simultaneously.

- **Type:** `ProviderConfig[]`
- **Default:** `[]`

See [Providers](../concepts/providers.md) for detailed provider documentation.

#### Email/Password

```yaml
providers:
  - type: email-password
    displayName: Email
    allowSignUp: true
    requireEmailVerification: false
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `"email-password"` | **Required** | Provider type |
| `displayName` | `string` | `"Email"` | Display name on login UI |
| `allowSignUp` | `boolean` | `true` | Allow new user registration |
| `requireEmailVerification` | `boolean` | `false` | Require email verification |

#### Keycloak

```yaml
providers:
  - type: keycloak
    issuer: ${KEYCLOAK_URL}
    realm: ${KEYCLOAK_REALM}
    clientId: ${KEYCLOAK_CLIENT_ID}
    clientSecret: ${KEYCLOAK_CLIENT_SECRET}
    displayName: Keycloak SSO
```

| Option | Type | Description |
|--------|------|-------------|
| `type` | `"keycloak"` | Provider type |
| `issuer` | `string` | Keycloak base URL |
| `realm` | `string` | Keycloak realm name |
| `clientId` | `string` | OAuth 2.0 client ID |
| `clientSecret` | `string` | OAuth 2.0 client secret |
| `displayName` | `string` | Display name (default: `"Keycloak"`) |

#### Auth0

```yaml
providers:
  - type: auth0
    domain: ${AUTH0_DOMAIN}
    clientId: ${AUTH0_CLIENT_ID}
    clientSecret: ${AUTH0_CLIENT_SECRET}
```

| Option | Type | Description |
|--------|------|-------------|
| `type` | `"auth0"` | Provider type |
| `domain` | `string` | Auth0 domain |
| `clientId` | `string` | OAuth 2.0 client ID |
| `clientSecret` | `string` | OAuth 2.0 client secret |

#### Okta

```yaml
providers:
  - type: okta
    domain: ${OKTA_DOMAIN}
    clientId: ${OKTA_CLIENT_ID}
    clientSecret: ${OKTA_CLIENT_SECRET}
```

#### Generic OIDC

```yaml
providers:
  - type: generic-oidc
    issuer: ${OIDC_ISSUER}
    clientId: ${OIDC_CLIENT_ID}
    clientSecret: ${OIDC_CLIENT_SECRET}
    displayName: "Corporate SSO"
```

### apiKeys

API keys for machine-to-machine authentication (CI/CD, monitoring, external services).

- **Type:** `ApiKeyConfig[]`
- **Default:** `[]`

```yaml
apiKeys:
  - key: ${GITLAB_DEPLOY_KEY}
    name: "GitLab CI/CD"
    roles:
      - deployer
  - key: ${MONITORING_KEY}
    name: "Monitoring Service"
    roles:
      - reader
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `key` | `string` | **Required** | API key value (supports `${ENV_VAR}`) |
| `name` | `string` | **Required** | Display name (used in X-Identity) |
| `roles` | `string[]` | `["api-client"]` | Roles assigned to this key |

### scim

SCIM 2.0 user provisioning configuration.

- **Type:** `ScimConfig`
- **Default:** `{ enabled: false }`

```yaml
scim:
  enabled: true
  maxResults: 100
  bulkEnabled: true
  maxBulkOperations: 1000
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable SCIM 2.0 endpoints |
| `maxResults` | `number` | `100` | Maximum results per page |
| `bulkEnabled` | `boolean` | `true` | Enable bulk operations |
| `maxBulkOperations` | `number` | `1000` | Max ops per bulk request |

## Complete Examples

### Local Development

```yaml
name: "@buntime/plugin-authn"
enabled: true

providers:
  - type: email-password
    allowSignUp: true

trustedOrigins:
  - "http://localhost:8000"
```

### Production (Keycloak + SCIM)

```yaml
name: "@buntime/plugin-authn"
enabled: true

providers:
  - type: keycloak
    issuer: ${KEYCLOAK_URL}
    realm: ${KEYCLOAK_REALM}
    clientId: ${KEYCLOAK_CLIENT_ID}
    clientSecret: ${KEYCLOAK_CLIENT_SECRET}

trustedOrigins:
  - "https://buntime.home"

scim:
  enabled: true

apiKeys:
  - key: ${CI_DEPLOY_KEY}
    name: "CI/CD Pipeline"
    roles: ["deployer"]
```

### Multi-Provider

```yaml
name: "@buntime/plugin-authn"
enabled: true

providers:
  - type: email-password
    displayName: Email
    allowSignUp: false

  - type: keycloak
    issuer: ${KEYCLOAK_URL}
    realm: ${KEYCLOAK_REALM}
    clientId: ${KEYCLOAK_CLIENT_ID}
    clientSecret: ${KEYCLOAK_CLIENT_SECRET}

trustedOrigins:
  - "https://buntime.home"
  - "https://app.example.com"
```

### Headless (API Keys Only)

```yaml
name: "@buntime/plugin-authn"
enabled: true

providers:
  - type: email-password

apiKeys:
  - key: ${SERVICE_KEY}
    name: "Backend Service"
    roles: ["admin"]
  - key: ${READONLY_KEY}
    name: "Read-Only Service"
    roles: ["reader"]
```

## Helm Values

```yaml
plugins:
  authn:
    providers:
      - type: keycloak
    trustedOrigins:
      - "https://buntime.home"
    scim:
      enabled: true
```

```bash
helm upgrade buntime ./charts/buntime \
  --set-json 'plugins.authn.providers=[{"type":"keycloak","issuer":"https://keycloak.example.com","realm":"myrealm","clientId":"buntime","clientSecret":"secret"}]'
```

## Next Steps

- [Setup Guide](setup.md) - Step-by-step setup
- [Providers](../concepts/providers.md) - Provider details
- [API Reference](../api-reference.md) - Endpoint reference
