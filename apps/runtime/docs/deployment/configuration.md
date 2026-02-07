# Overview

The runtime uses layered configuration:

| Level | File/Source | Purpose |
|-------|-------------|---------|
| Runtime | Environment variables | Global configuration (poolSize, workerDirs, pluginDirs) |
| Plugins | `manifest.yaml` | Metadata and configuration for each plugin |
| Workers/Apps | `manifest.yaml` | Individual configuration for each application |
| Build-time | `bunfig.toml` | Bun build plugins (i18next, iconify, TSR, Tailwind) |
| UI | `components.json` | Shadcn UI configuration |

# Runtime Configuration (Environment Variables)

The runtime is configured exclusively via environment variables. There is no configuration file for the runtime itself.

## Available Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `8000` | Server port |
| `NODE_ENV` | string | `development` | Environment (development, production, staging, test) |
| `RUNTIME_WORKER_DIRS` | string (PATH style) | **Required** | Worker application directories |
| `RUNTIME_PLUGIN_DIRS` | string (PATH style) | `./plugins` | Plugin directories |
| `RUNTIME_POOL_SIZE` | number | `500` (prod), `50` (staging), `10` (dev), `5` (test) | Maximum worker pool size |
| `RUNTIME_LOG_LEVEL` | string | `info` (prod), `debug` (dev) | Log level (debug, info, warn, error) |
| `DELAY_MS` | number | `100` | Delay in milliseconds for graceful operations |

## Body Size Limits

The runtime enforces body size limits for request payloads:

| Limit | Value | Description |
|-------|-------|-------------|
| `bodySize.default` | 10 MB | Default limit for all workers |
| `bodySize.max` | 100 MB | Maximum allowed (ceiling for per-worker config) |

Workers can configure their own limit via `maxBodySize` in `manifest.yaml`, up to the maximum.

## Configuration Example

```bash
# .env
PORT=8000
RUNTIME_WORKER_DIRS=/apps:/external-apps
RUNTIME_PLUGIN_DIRS=/plugins:/custom-plugins
RUNTIME_POOL_SIZE=200
RUNTIME_LOG_LEVEL=info
```

> [!TIP]
> `RUNTIME_WORKER_DIRS` and `RUNTIME_PLUGIN_DIRS` use PATH style format (colon-separated). Example: `/data/.apps:/data/apps`

# Plugin Configuration (manifest.yaml)

Each plugin has its own configuration in `manifest.yaml` in the plugin directory:

```yaml
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
enabled: true
entrypoint: dist/client/index.html  # Plugin UI (if any)
adapters:
  - type: libsql
    urls:
      - "http://localhost:8880"
```

> [!NOTE]
> The enabled/disabled state is controlled by the `enabled` field in manifest.yaml. Use `enabled: false` to disable a plugin.

## Plugin Auto-Discovery

Plugins are automatically discovered from directories in `RUNTIME_PLUGIN_DIRS`.

### Per-Plugin Configuration

Each plugin has its own `manifest.yaml` in the plugin directory:

```yaml
# plugins/plugin-keyval/manifest.yaml
name: "@buntime/plugin-keyval"
base: "/keyval"
enabled: true
dependencies:
  - "@buntime/plugin-database"
entrypoint: dist/client/index.html  # Plugin UI (if any)
```

### Plugin Resolution Order

The runtime resolves plugins in the following order:

1. **Built-in plugins** - Embedded in the binary (always available)
2. **External plugins** - Discovered from `pluginDirs`
3. **Node modules** - From `node_modules` (dev mode only)

```
Plugin Resolution:
  1. Built-in: @buntime/plugin-metrics (embedded)
  2. External: ./plugins/plugin-keyval/plugin.ts
  3. Node modules: node_modules/@company/buntime-plugin-xyz
```

### Plugin Dependencies

Plugins are automatically sorted based on dependencies using topological sorting. Plugins define their dependencies in `manifest.yaml`:

```yaml
# plugins/plugin-keyval/manifest.yaml
name: "@buntime/plugin-keyval"
base: "/keyval"
dependencies:
  - "@buntime/plugin-database"    # Required
optionalDependencies: []          # Optional
```

> [!IMPORTANT]
> If a plugin declares required dependencies, those dependencies must be enabled (`enabled: true` in manifest.yaml).

### Plugin-Specific Configuration

Each plugin has its own configuration options in its `manifest.yaml`. Examples:

```yaml
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
adapters:
  - type: libsql
    urls:
      - "${LIBSQL_URL}"  # Environment variable interpolation
```

```yaml
# plugins/plugin-gateway/manifest.yaml
name: "@buntime/plugin-gateway"
base: "/gateway"
rateLimit:
  requests: 1000
  window: "1m"
  keyBy: ip
cache:
  ttl: 300
  methods:
    - GET
```

```yaml
# plugins/plugin-proxy/manifest.yaml
name: "@buntime/plugin-proxy"
base: "/proxy"
rules:
  - name: CPanel App
    pattern: "^/cpanel(/.*)?$"
    target: "http://localhost:4000"
    rewrite: "$1"
    changeOrigin: true
    ws: true
```

## Environment Variable Interpolation

The runtime supports environment variable interpolation in configuration values using the `${VAR_NAME}` syntax:

```yaml
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
adapters:
  - type: libsql
    urls:
      - "${LIBSQL_URL}"  # Replaced with process.env.LIBSQL_URL
```

> [!TIP]
> This allows the same configuration file to work across development, staging, and production environments by only changing the `.env` file.

# Worker Configuration

## Configuration Location

Workers are configured via `manifest.yaml` file in the application directory.

```yaml
# apps/todos-kv/manifest.yaml
entrypoint: dist/index.js
idleTimeout: 30
lowMemory: false
maxRequests: 100
timeout: 30
ttl: 60
```

## Worker Options

### entrypoint

Entry file for the worker application.

| Type | `string` |
|------|----------|
| Default | `index.ts` or main field from package.json |
| Example | `"dist/index.js"` |

```yaml
# manifest.yaml
entrypoint: dist/index.js  # Use built output
```

### autoInstall

Runs `bun install --frozen-lockfile` before starting the worker.

| Type | `boolean` |
|------|-----------|
| Default | `false` |
| Example | `true` |

```yaml
# manifest.yaml
autoInstall: true  # Install dependencies before worker starts
```

### env

Additional environment variables to pass to the worker.

| Type | `Record<string, string>` |
|------|--------------------------|
| Default | None |
| Example | `{ "API_KEY": "abc123", "DEBUG": "true" }` |

```yaml
# manifest.yaml
env:
  API_KEY: abc123
  DEBUG: "true"
```

### publicRoutes

Defines public routes that bypass authentication.

| Type | Array or object |
|------|-----------------|
| Default | None |
| Example | See plugin documentation for format |

```yaml
# manifest.yaml
publicRoutes:
  - /health
  - /public/*
```

> [!NOTE]
> The exact format depends on the authentication plugin being used. Consult the plugin documentation for details.

### idleTimeout

Time in seconds before an idle worker is terminated.

| Type | `number` |
|------|----------|
| Default | `60` |
| Example | `60` |

```yaml
# manifest.yaml
idleTimeout: 60  # Terminate worker after 60 seconds of inactivity
```

### lowMemory

Enables low memory mode (restricts worker memory usage).

| Type | `boolean` |
|------|-----------|
| Default | `false` |
| Example | `false` |

```yaml
# manifest.yaml
lowMemory: false  # Normal memory mode
```

### maxBodySize

Body size limit for this specific worker. If not defined, uses the global `bodySize.default`.

| Type | `number | string` |
|------|-------------------|
| Default | Global `bodySize.default` (10mb) |
| Maximum | Global `bodySize.max` (100mb) |
| Example | `"50mb"` or `52428800` |

```yaml
# manifest.yaml
maxBodySize: 50mb  # Accept uploads up to 50MB on this worker
```

Accepted formats: number in bytes or string with unit (`"10mb"`, `"1gb"`).

> [!WARNING]
> If `maxBodySize` exceeds the global `bodySize.max`, the runtime will log a warning and use the maximum value.

### maxRequests

Maximum number of requests a worker can process before being recycled.

| Type | `number` |
|------|----------|
| Default | `1000` |
| Example | `1000` |

```yaml
# manifest.yaml
maxRequests: 1000  # Recycle worker after 1000 requests
```

> [!IMPORTANT]
> Workers are recycled to prevent memory leaks and ensure consistent performance over time.

### timeout

Maximum time in seconds for a single request.

| Type | `number` |
|------|----------|
| Default | `30` |
| Example | `30` |

```yaml
# manifest.yaml
timeout: 30  # Terminate request after 30 seconds
```

### ttl

Time to live in seconds for the worker instance.

| Type | `number` |
|------|----------|
| Default | `0` (no TTL limit) |
| Example | `60` |

```yaml
# manifest.yaml
ttl: 60  # Terminate worker after 60 seconds regardless of activity
```

> [!NOTE]
> When set to `0` (default), workers have no TTL limit and will be terminated only based on `idleTimeout` or `maxRequests`.

### visibility (plugin-deployments)

Controls application visibility in the deployments UI. This field is read by `plugin-deployments`, not by the runtime core.

| Type | `"public" | "protected" | "internal"` |
|------|----------------------------------------|
| Default | `"public"` |
| Example | `"protected"` |

```yaml
# manifest.yaml
visibility: protected
```

Values:

- `public`: Visible and editable (default)
- `protected`: Visible but read-only
- `internal`: Hidden from the deployments browser

> [!NOTE]
> This field is not part of the runtime's worker config schema. It is processed exclusively by `@buntime/plugin-deployments`. Should be added to the worker's `manifest.yaml`.

# Build-Time Plugins (bunfig.toml)

The runtime client (React dashboard) uses Bun plugins for build-time transformations:

```toml
[serve.static]
plugins = [
  "@zomme/bun-plugin-tsr",       # TanStack Router generation
  "@zomme/bun-plugin-iconify",   # Icon collection
  "@zomme/bun-plugin-i18next",   # Translation loading
  "bun-plugin-tailwind",         # Tailwind CSS
]

[plugins.tsr]
rootDirectory = "client"

[plugins.iconify]
dirs = ["client"]

[plugins.i18next]
dirs = "client"
```

## Available Plugins

| Plugin | Purpose |
|--------|---------|
| `@zomme/bun-plugin-tsr` | Generates TanStack Router routes from file structure |
| `@zomme/bun-plugin-iconify` | Provides icon collections via Icon component |
| `@zomme/bun-plugin-i18next` | Loads translations from colocalized JSON files |
| `bun-plugin-tailwind` | Tailwind CSS processing |

Consult the plugin documentation for detailed configuration options.

# Environment Variables (.env)

The runtime loads environment variables from `.env` in the current working directory:

```
/home/user/Developer/zomme/buntime/
└── runtime/
    ├── .env      # Environment variables (runtime configuration)
    └── index.ts
```

> [!NOTE]
> All runtime configuration is done via environment variables. See the [Runtime Configuration (Environment Variables)](#runtime-configuration-environment-variables) section for the complete list.

## Plugin Variables

Plugins may require additional environment variables:

| Variable | Description | Plugin |
|----------|-------------|--------|
| `LIBSQL_URL` | libSQL server URL | plugin-database, plugin-keyval |
| `KEYCLOAK_URL` | Keycloak server URL | plugin-authn |

## Complete Configuration Example

```bash
# Runtime Configuration
PORT=8000
NODE_ENV=production
RUNTIME_WORKER_DIRS=/apps:/external-apps
RUNTIME_PLUGIN_DIRS=/plugins
RUNTIME_POOL_SIZE=200
RUNTIME_LOG_LEVEL=info

# libSQL database URL (for plugins that use KeyVal storage)
# Options:
#   - Docker/remote: http://localhost:8880 (recommended)
#   - Local file: file:/absolute/path/to/buntime.db
# Note: Relative paths don't work with compiled binaries
LIBSQL_URL=http://localhost:8880
```

> [!IMPORTANT]
> When using `file:` URLs for libSQL, always use absolute paths. Relative paths fail with compiled binaries.

# Shadcn UI Configuration (components.json)

The runtime dashboard uses Shadcn UI components. Configuration is in `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "~/components",
    "utils": "~/utils/cn",
    "ui": "~/components/ui",
    "lib": "~/libs",
    "hooks": "~/hooks"
  }
}
```

This configuration is used by the `shadcn` CLI when adding new components:

```bash
npx shadcn add button
```

# Complete Configuration Example

## Development

```bash
# .env (runtime configuration)
RUNTIME_WORKER_DIRS=../../buntime-apps:../examples
RUNTIME_PLUGIN_DIRS=./plugins
RUNTIME_POOL_SIZE=10  # default for development
PORT=8000
LIBSQL_URL=http://localhost:8880
```

```yaml
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
adapters:
  - type: libsql
    urls:
      - "http://localhost:8880"
```

```yaml
# plugins/plugin-keyval/manifest.yaml
name: "@buntime/plugin-keyval"
base: "/keyval"
dependencies:
  - "@buntime/plugin-database"
```

```yaml
# plugins/plugin-metrics/manifest.yaml
name: "@buntime/plugin-metrics"
base: "/metrics"
```

> [!NOTE]
> Use the CLI (`buntime-cli`) or API (`PUT /api/plugins/:name/enable`) to enable plugins after installation.

## Production

```bash
# .env (runtime configuration)
RUNTIME_WORKER_DIRS=/data/apps
RUNTIME_PLUGIN_DIRS=/data/plugins
RUNTIME_POOL_SIZE=500
PORT=8000
RUNTIME_LOG_LEVEL=info
LIBSQL_URL=${LIBSQL_URL}
LIBSQL_TOKEN=${LIBSQL_TOKEN}
```

```yaml
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
adapters:
  - type: libsql
    urls:
      - "${LIBSQL_URL}"
    authToken: "${LIBSQL_TOKEN}"
```

```yaml
# plugins/plugin-keyval/manifest.yaml
name: "@buntime/plugin-keyval"
base: "/keyval"
dependencies:
  - "@buntime/plugin-database"
queue:
  cleanupInterval: 300000
  lockDuration: 60000
metrics:
  persistent: true
  flushInterval: 30000
```

```yaml
# plugins/plugin-gateway/manifest.yaml
name: "@buntime/plugin-gateway"
base: "/gateway"
rateLimit:
  requests: 1000
  window: "1m"
  keyBy: ip
cache:
  ttl: 300
  methods:
    - GET
  maxEntries: 10000
cors:
  origin: "https://app.example.com"
  credentials: true
```

```yaml
# plugins/plugin-authn/manifest.yaml
name: "@buntime/plugin-authn"
base: "/authn"
dependencies:
  - "@buntime/plugin-database"
provider: keycloak
issuer: "${KEYCLOAK_URL}"
realm: "${KEYCLOAK_REALM}"
clientId: "${KEYCLOAK_CLIENT_ID}"
excludePaths:
  - /health
  - /metrics
```

```yaml
# plugins/plugin-authz/manifest.yaml
name: "@buntime/plugin-authz"
base: "/authz"
dependencies:
  - "@buntime/plugin-database"
store: database
combiningAlgorithm: deny-overrides
```

```bash
# .env
NODE_ENV=production
PORT=8000
RUNTIME_WORKER_DIRS=/app/buntime-apps

# Database
LIBSQL_URL=http://libsql:8080
LIBSQL_TOKEN=<jwt-token>
LIBSQL_REPLICA_URL=http://libsql-replica:8080

# Authentication
KEYCLOAK_URL=https://auth.example.com
KEYCLOAK_REALM=production
KEYCLOAK_CLIENT_ID=buntime
```

# Configuration Validation

The runtime validates configuration at startup and provides helpful error messages:

```
# Missing required plugin dependency
Error: Plugin "@buntime/plugin-proxy" requires "@buntime/plugin-keyval" which is not available.
Ensure "@buntime/plugin-keyval" is installed in pluginDirs.

# Circular dependency
Error: Circular dependency detected among plugins: @buntime/plugin-a, @buntime/plugin-b

# Invalid plugin manifest.yaml
Error: Plugin "plugin-keyval" manifest is missing required field: name

# Plugin disabled
[DEBUG] Skipping disabled plugin: @buntime/plugin-example
```

# Configuration Best Practices

## Use Environment Variables

Store sensitive data in `.env`, not in `manifest.yaml`:

```yaml
# WRONG - hardcoded secrets
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
adapters:
  - type: libsql
    urls:
      - "http://production-db:8080"
    authToken: "secret-token-here"  # NEVER do this
```

```yaml
# CORRECT - use environment variables
# plugins/plugin-database/manifest.yaml
name: "@buntime/plugin-database"
base: "/database"
adapters:
  - type: libsql
    urls:
      - "${LIBSQL_URL}"
    authToken: "${LIBSQL_TOKEN}"
```

## Separate Responsibilities

Use different configuration files for different purposes:

- **.env** - Runtime configuration (workerDirs, poolSize, etc)
- **plugins/\*/manifest.yaml** - Individual plugin manifest (metadata + config)
- **apps/\*/manifest.yaml** - Individual worker/app configuration
- **bunfig.toml** - Build-time transformations (Bun plugins)
- **components.json** - UI framework configuration

## Document Custom Plugins

If using custom external plugins, document them in your project README:

```
plugins/
├── my-plugin/
│   ├── manifest.yaml  # Plugin manifest
│   ├── plugin.ts       # Plugin implementation
│   └── README.md       # Document your plugin
```

## Version Control

Add to `.gitignore`:

```
# Environment files (secrets)
.env
.env.local

# Keep examples
!.env.example
```

Commit to version control:

```
# Configuration (no secrets)
bunfig.toml
components.json
.env.example
plugins/*/manifest.yaml
```
