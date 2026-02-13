# Setup Guide

Step-by-step guide to configure authentication in Buntime.

## Prerequisites

- Buntime runtime running
- plugin-database enabled and configured
- (Optional) OIDC provider (Keycloak, Auth0, Okta) for SSO

## Step 1: Enable Database Plugin

The authn plugin requires plugin-database for session and user storage:

```yaml
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
enabled: true
adapters:
  - type: sqlite
    baseDir: ./.cache/sqlite/
    default: true
```

## Step 2: Configure Authentication

### Option A: Email/Password (Development)

Simplest setup for local development:

```yaml
# plugins/plugin-authn/manifest.yaml
name: "@buntime/plugin-authn"
enabled: true

providers:
  - type: email-password
    allowSignUp: true

trustedOrigins:
  - "http://localhost:8000"
```

Start the runtime and navigate to `http://localhost:8000/auth/login` to create your first user.

### Option B: Keycloak (Production)

For enterprise SSO with Keycloak:

#### 1. Create Keycloak Client

In Keycloak admin console:
1. Go to **Clients > Create client**
2. Set Client ID: `buntime`
3. Set Client protocol: `openid-connect`
4. Set Access Type: `confidential`
5. Set Valid Redirect URIs: `https://buntime.home/auth/api/auth/callback/keycloak`
6. Set Post Logout Redirect URIs: `https://buntime.home/*`
7. Save and note the Client Secret from the **Credentials** tab

#### 2. Configure Plugin

```yaml
# plugins/plugin-authn/manifest.yaml
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
```

#### 3. Set Environment Variables

```bash
KEYCLOAK_URL=https://keycloak.example.com
KEYCLOAK_REALM=myrealm
KEYCLOAK_CLIENT_ID=buntime
KEYCLOAK_CLIENT_SECRET=your-client-secret
```

### Option C: Auth0

#### 1. Create Auth0 Application

1. In Auth0 Dashboard, go to **Applications > Create Application**
2. Choose **Regular Web Application**
3. Set Allowed Callback URLs: `https://buntime.home/auth/api/auth/callback/auth0`
4. Set Allowed Logout URLs: `https://buntime.home`

#### 2. Configure Plugin

```yaml
providers:
  - type: auth0
    domain: ${AUTH0_DOMAIN}
    clientId: ${AUTH0_CLIENT_ID}
    clientSecret: ${AUTH0_CLIENT_SECRET}
```

## Step 3: Add API Keys (Optional)

For CI/CD pipelines and service-to-service communication:

```yaml
apiKeys:
  - key: ${CI_DEPLOY_KEY}
    name: "CI/CD Pipeline"
    roles: ["deployer"]
```

Set the environment variable:

```bash
CI_DEPLOY_KEY=your-secure-api-key-here
```

Test:

```bash
curl -H "X-API-Key: your-secure-api-key-here" \
  http://localhost:8000/_/api/workers
```

## Step 4: Enable SCIM (Optional)

For automated user provisioning from your identity provider:

```yaml
scim:
  enabled: true
  maxResults: 100
```

Configure your IdP to provision users to `https://buntime.home/auth/api/scim/v2/`.

## Step 5: Configure Public Routes

Workers can define routes that bypass authentication:

```yaml
# apps/my-app/manifest.yaml
name: my-app
publicRoutes:
  ALL: ["/api/health"]
  GET: ["/api/public/**"]
  POST: ["/api/webhook"]
```

## Step 6: Test Authentication

### Browser Flow

1. Navigate to `http://localhost:8000/` (should redirect to login)
2. Sign in with your chosen provider
3. After login, you should be redirected back
4. Navigate to `http://localhost:8000/auth/api/session` to verify session

### API Flow

```bash
# Sign in and get session cookie
curl -X POST http://localhost:8000/auth/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}' \
  -c cookies.txt

# Use session cookie
curl http://localhost:8000/api/protected \
  -b cookies.txt

# Use API key
curl http://localhost:8000/api/protected \
  -H "X-API-Key: your-key"
```

### Verify Identity Injection

```bash
# Check what identity is being injected (from a worker endpoint that echoes headers)
curl http://localhost:8000/my-app/api/debug-headers \
  -b cookies.txt
```

## Step 7: Enable Authorization (Optional)

Add plugin-authz for policy-based access control:

```yaml
# plugins/plugin-authz/manifest.yaml
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
```

## Troubleshooting

### Login page shows no providers

**Problem:** No providers configured or `providers` array is empty.

**Solution:** Add at least one provider:
```yaml
providers:
  - type: email-password
```

### OIDC redirect fails

**Problem:** Callback URL mismatch or invalid client configuration.

**Solution:**
1. Verify the callback URL in your IdP matches: `https://your-host/auth/api/auth/callback/{provider}`
2. Verify `trustedOrigins` includes your domain
3. Check environment variables are set correctly

### Session not persisting

**Problem:** Cookie not being set or stored.

**Solution:**
1. Ensure `trustedOrigins` includes your domain
2. Check browser dev tools for Set-Cookie header
3. For cross-origin, ensure CORS is configured in plugin-gateway

### API key returns 401

**Problem:** Key not matching configuration.

**Solution:**
1. Verify the key value matches exactly (including any whitespace)
2. Check environment variable substitution: `echo $CI_DEPLOY_KEY`
3. Ensure `apiKeys` is configured in manifest

## Next Steps

- [Configuration](configuration.md) - Complete reference
- [Providers](../concepts/providers.md) - Provider details
- [SCIM 2.0](../concepts/scim.md) - Enterprise provisioning
- [API Reference](../api-reference.md) - Endpoint reference
