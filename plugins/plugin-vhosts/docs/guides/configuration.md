# Configuration

Complete reference for all plugin-vhosts configuration options.

## Configuration Method

### manifest.yaml

The vhosts plugin is configured entirely via `manifest.yaml`. There is no API, no environment variable overrides, and no runtime configuration.

```yaml
# plugins/plugin-vhosts/manifest.yaml
name: "@buntime/plugin-vhosts"
base: ""
enabled: false

pluginEntry: dist/plugin.js

hosts:
  "sked.ly":
    app: "skedly@latest"
  "*.sked.ly":
    app: "skedly@latest"
  "dashboard.example.com":
    app: "admin-panel"
    pathPrefix: "/admin"
```

## Configuration Options

### hosts

Map of hostname patterns to virtual host configurations.

- **Type:** `Record<string, VHostConfig>`
- **Default:** `{}` (no virtual hosts)
- **Required:** Yes (for the plugin to do anything useful)

```yaml
hosts:
  "example.com":
    app: "my-app@latest"
```

Each key is a hostname pattern (exact or wildcard), and the value is a `VHostConfig` object.

### VHostConfig

#### app

The worker application to serve for this virtual host. Must match an app name known to Buntime (installed in the apps directory).

- **Type:** `string`
- **Required:** Yes

```yaml
app: "skedly@latest"
```

The value is passed to the runtime's `getWorkerDir()` function to resolve the worker directory.

**Examples:**

```yaml
# With version tag
app: "skedly@latest"

# Without version
app: "my-app"

# Admin panel
app: "admin-panel"
```

#### pathPrefix

Limit virtual host routing to requests whose path starts with this prefix. If the path doesn't match, the request falls through to the normal pipeline.

- **Type:** `string`
- **Required:** No
- **Default:** `undefined` (all paths are matched)

```yaml
pathPrefix: "/admin"
```

**Behavior:**
- `/admin` → Matched, served by worker
- `/admin/users` → Matched, served by worker
- `/` → Not matched, falls through
- `/other` → Not matched, falls through

### Host Patterns

| Pattern Format | Description | Example |
|---------------|-------------|---------|
| `example.com` | Exact hostname match | `example.com` only |
| `*.example.com` | Wildcard subdomain match | `tenant1.example.com`, `acme.example.com` |
| `sub.example.com` | Exact subdomain match | `sub.example.com` only |

See [Hostname Matching](../concepts/hostname-matching.md) for detailed matching rules and priority.

## Complete Examples

### Simple Custom Domain

Serve a single app on a custom domain:

```yaml
name: "@buntime/plugin-vhosts"
enabled: true
hosts:
  "myapp.com":
    app: "my-app@latest"
```

Requests to `myapp.com` serve `my-app` at root (`/`) instead of `/my-app/`.

### Multi-Tenant SaaS

Serve the same app for all tenant subdomains:

```yaml
name: "@buntime/plugin-vhosts"
enabled: true
hosts:
  "sked.ly":
    app: "skedly@latest"
  "*.sked.ly":
    app: "skedly@latest"
```

- `sked.ly` → Serves skedly at root (marketing/landing page)
- `tenant1.sked.ly` → Serves skedly at root with `x-vhost-tenant: tenant1`
- `acme.sked.ly` → Serves skedly at root with `x-vhost-tenant: acme`

### Multiple Apps on Different Domains

Route different domains to different worker apps:

```yaml
name: "@buntime/plugin-vhosts"
enabled: true
hosts:
  "sked.ly":
    app: "skedly-client@latest"
  "admin.sked.ly":
    app: "skedly-admin@latest"
  "api.sked.ly":
    app: "skedly-server@latest"
  "kashes.io":
    app: "kashes-client@latest"
```

### With Path Prefix

Limit routing to specific paths:

```yaml
name: "@buntime/plugin-vhosts"
enabled: true
hosts:
  "dashboard.example.com":
    app: "admin-panel"
    pathPrefix: "/admin"
```

Only `dashboard.example.com/admin/*` routes to the worker. Other paths fall through.

### Multiple Domains for Same App

Serve the same app under different brand domains:

```yaml
name: "@buntime/plugin-vhosts"
enabled: true
hosts:
  # Brand 1
  "sked.ly":
    app: "skedly@latest"
  "*.sked.ly":
    app: "skedly@latest"

  # Brand 2 (same app, different domain)
  "scheduling.io":
    app: "skedly@latest"
  "*.scheduling.io":
    app: "skedly@latest"
```

### Local Development

Use custom hostnames in development:

```yaml
name: "@buntime/plugin-vhosts"
enabled: true
hosts:
  "myapp.localhost":
    app: "my-app@latest"
  "*.myapp.localhost":
    app: "my-app@latest"
```

Add to `/etc/hosts`:

```
127.0.0.1 myapp.localhost
127.0.0.1 tenant1.myapp.localhost
127.0.0.1 tenant2.myapp.localhost
```

### Disabled (Default)

The plugin is disabled by default:

```yaml
name: "@buntime/plugin-vhosts"
enabled: false
```

## Important Notes

### No Duplicate Hostname Keys

YAML does not support duplicate keys. This will NOT work:

```yaml
# BROKEN: Second key overwrites first
hosts:
  "example.com":
    app: "marketing-site"
  "example.com":           # This overwrites the above!
    app: "app-dashboard"
    pathPrefix: "/app"
```

For path-based routing on the same hostname, use the proxy plugin instead.

### Authentication Bypass

Requests matched by vhosts bypass the entire plugin pipeline, including authentication. The worker application must handle its own authentication.

### No Runtime Changes

Virtual host configuration cannot be changed at runtime. To add or remove hosts, edit the manifest and restart Buntime.

## Validation

### Verify Virtual Host Resolution

```bash
# Test exact match
curl -H "Host: sked.ly" http://localhost:8000/
# Should serve the app at root

# Test wildcard match
curl -H "Host: tenant1.sked.ly" http://localhost:8000/
# Should serve the app with x-vhost-tenant header

# Test non-matching host
curl -H "Host: unknown.example.com" http://localhost:8000/
# Should fall through to normal pipeline
```

### Verify Tenant Header

```bash
# Check response headers or add a debug endpoint in the worker
curl -v -H "Host: tenant1.sked.ly" http://localhost:8000/api/debug
# Worker receives x-vhost-tenant: tenant1
```

### Verify Path Prefix

```bash
# With pathPrefix: "/admin"

# Should be served by worker
curl -H "Host: dashboard.example.com" http://localhost:8000/admin/users

# Should fall through (path doesn't match prefix)
curl -H "Host: dashboard.example.com" http://localhost:8000/other
```

## Next Steps

- [API Reference](../api-reference.md) - server.fetch hook behavior
- [Overview](../concepts/overview.md) - Architecture and design decisions
- [Hostname Matching](../concepts/hostname-matching.md) - Matching rules deep dive
- [Multi-Tenant Setup](multi-tenant-setup.md) - DNS, certificates, and tenant routing
