# External Plugins Guide

This guide covers how to install and manage external plugins in a running Buntime instance, including hot-reload capabilities.

## Overview

Buntime supports loading plugins from multiple directories configured via `RUNTIME_PLUGIN_DIRS` (or `PLUGIN_DIRS`). External plugins can be added at runtime without rebuilding the Docker image.

```bash
# Example configuration
RUNTIME_PLUGIN_DIRS=/data/.plugins:/data/plugins
```

- `/data/.plugins` - Built-in plugins (compiled in Docker image)
- `/data/plugins` - External plugins (added at runtime)

## Plugin Structure

An external plugin requires at minimum:

```
/data/plugins/my-plugin/
├── manifest.yaml      # Required: Plugin metadata
└── dist/
    └── plugin.js      # Required: Compiled plugin code
```

### Manifest Schema

```yaml
# Required fields
name: "@scope/plugin-name"    # Unique identifier
enabled: true                  # Enable/disable plugin
pluginEntry: dist/plugin.js    # Path to compiled plugin code

# Optional fields
base: /my-route               # Base path for routes (if plugin exposes routes)
entrypoint: dist/client/index.html  # UI entrypoint (if plugin has frontend)

# Dependencies
dependencies:
  - "@buntime/plugin-database"    # Required plugins (throws if missing)
optionalDependencies:
  - "@buntime/plugin-proxy"       # Optional plugins (ignored if missing)

# Public routes (bypass authentication)
publicRoutes:
  GET: ["/api/public/**"]
  POST: ["/api/webhook"]

# Menu items for cpanel
menus:
  - icon: lucide:key
    path: /my-route
    title: My Plugin
```

## Installing External Plugins

### Method 0: CLI/TUI Upload

The CLI discovers the runtime API prefix from `/.well-known/buntime`, so it
works with both `/api` and prefixed deployments such as `/_/api`.

```bash
buntime --url https://buntime.home --token "$RUNTIME_MASTER_KEY" --insecure plugin install ./my-plugin.zip
```

When using the TUI, add the runtime URL, enter the master deploy key when
prompted, then choose **API Keys → Add** to create an `editor` deploy key for
day-to-day uploads. Use that generated key for **Plugins → Install** and
**Apps → Install**. Directory uploads are compressed locally before upload.

The master deploy key must be configured with `RUNTIME_MASTER_KEY` in the
runtime environment. In Kubernetes, set `buntime.masterKey` so Helm stores it in
a Secret. Generated API keys are stored as hashes under the runtime state
directory, which defaults to `/data/plugins/.buntime` in the Helm layout.

The runtime API base is configurable. The CLI/TUI discovers it from
`/.well-known/buntime`, so deployments using `RUNTIME_API_PREFIX="/_"` are
called through `/_/api` automatically. Plugin routes, such as
`/deployments/api/*`, are not moved by this prefix.

### Method 1: kubectl cp (Kubernetes)

Copy plugin files directly to the running pod:

```bash
# Get the pod name
POD=$(kubectl -n zomme get pods -l app=buntime -o jsonpath='{.items[0].metadata.name}')

# Create the plugin directory
kubectl -n zomme exec $POD -- mkdir -p /data/plugins/my-plugin

# Copy manifest
kubectl -n zomme cp ./my-plugin/manifest.yaml $POD:/data/plugins/my-plugin/manifest.yaml

# Copy dist folder
kubectl -n zomme cp ./my-plugin/dist $POD:/data/plugins/my-plugin/dist

# Verify files
kubectl -n zomme exec $POD -- ls -la /data/plugins/my-plugin/
```

### Method 2: API Upload

Upload a plugin archive via the API:

```bash
# Package the plugin
tar -czvf my-plugin.tgz -C ./my-plugin .

# Upload via API
curl -X POST https://buntime.home/_/api/plugins/upload \
  -H "X-API-Key: $RUNTIME_MASTER_KEY" \
  -H "Origin: https://buntime.home" \
  -F "file=@my-plugin.tgz"
```

### Method 3: Persistent Volume

Mount a persistent volume at `/data/plugins` and manage plugins via the volume.

## Hot Reload

After installing or modifying plugins, trigger a reload:

```bash
curl -X POST https://buntime.home/_/api/plugins/reload \
  -H "X-API-Key: $RUNTIME_MASTER_KEY" \
  -H "Origin: https://buntime.home"
```

**Response:**

```json
{
  "ok": true,
  "plugins": [
    { "name": "@buntime/plugin-database", "version": "0.0.0" },
    { "name": "@buntime/plugin-proxy", "version": "0.0.0" },
    { "name": "@scope/my-plugin", "version": "0.0.0" }
  ]
}
```

## API Reference

### List Loaded Plugins

```bash
GET /_/api/plugins/loaded
X-API-Key: <master-key>
```

### Reload All Plugins

```bash
POST /_/api/plugins/reload
X-API-Key: <master-key>
Origin: https://buntime.home
```

### Remove Plugin

```bash
DELETE /_/api/plugins/:name
X-API-Key: <master-key>
Origin: https://buntime.home

# Example (URL-encoded name)
DELETE /_/api/plugins/%40scope%2Fmy-plugin
```

## Common Issues

### Plugin Not Loading

1. **Missing `pluginEntry`**: The manifest must specify the path to the compiled plugin code:

   ```yaml
   pluginEntry: dist/plugin.js
   ```

2. **Wrong directory**: Ensure the plugin is in a configured `PLUGIN_DIRS` path.

3. **Disabled plugin**: Check `enabled: true` in manifest.

4. **Missing dependencies**: Check if required dependencies are loaded first.

### Check Logs

```bash
# View pod logs
kubectl -n zomme logs -f $POD | grep -i plugin

# Look for loading messages
# [PluginLoader] Loaded: @scope/my-plugin (/data/plugins/my-plugin)
```

### Verify Plugin Directory

```bash
kubectl -n zomme exec $POD -- ls -la /data/plugins/
kubectl -n zomme exec $POD -- cat /data/plugins/my-plugin/manifest.yaml
```

## Example: Installing auth-token Plugin

Complete example installing an authentication token plugin:

```bash
# 1. Get pod name
POD=$(kubectl -n zomme get pods -l app=buntime -o jsonpath='{.items[0].metadata.name}')

# 2. Create plugin directory
kubectl -n zomme exec $POD -- mkdir -p /data/plugins/auth-token

# 3. Copy files
kubectl -n zomme cp ./plugin-auth-token/dist $POD:/data/plugins/auth-token/dist

# 4. Create manifest with pluginEntry
kubectl -n zomme exec $POD -- sh -c 'cat > /data/plugins/auth-token/manifest.yaml << EOF
name: "@scope/plugin-auth-token"
enabled: true
base: /auth-token
pluginEntry: dist/plugin.js

optionalDependencies:
  - "@buntime/plugin-proxy"
EOF'

# 5. Verify files
kubectl -n zomme exec $POD -- ls -la /data/plugins/auth-token/

# 6. Reload plugins
curl -X POST https://buntime.home/_/api/plugins/reload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: https://buntime.home"
```

## Plugin Naming

Plugin names can use any scope (not limited to `@buntime/`):

- `@buntime/plugin-database` - Built-in plugins
- `@scope/plugin-auth-token` - Custom scope
- `@company/plugin-custom` - Company-specific plugins
- `my-plugin` - Unscoped plugins

The naming convention doesn't affect functionality - use whatever makes sense for your organization.

## Security Notes

1. **Authentication Required**: All plugin management endpoints require authentication.

2. **CSRF Protection**: State-changing requests (POST, DELETE) require an `Origin` header.

3. **File Permissions**: Ensure plugin files are readable by the runtime process.

4. **Sensitive Data**: Don't include secrets in manifest.yaml - use environment variables instead.
