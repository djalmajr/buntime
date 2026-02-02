---
name: plugins
summary: |
  - Plugins use manifest.yaml (not manifest.jsonc)
  - Entry points: pluginEntry (server), entrypoint (client)
  - Hooks: onInit, onRequest, onResponse, onShutdown
  - Plugin routes use their own base path (e.g., /redirects/api/rules), NOT runtime API prefix
  - Write tests for all plugin changes
  - Run bun test after modifications
---

# Buntime Plugin Quick Reference

Concise reference for plugin development. Full documentation: `apps/runtime/docs/concepts/plugin-system.md`

## Plugin Structure

```
plugins/plugin-example/
├── manifest.yaml      # Metadata + config
├── plugin.ts          # Middleware (persistent, main process)
├── index.ts           # Worker entrypoint (serverless, worker pool)
├── server/api.ts      # Shared API code
└── dist/              # Compiled output
```

## API Modes (CRITICAL)

**Choose ONE mode per plugin. Don't duplicate API in both.**

| Mode | Use When | `plugin.ts` | `index.ts` | entrypoint |
|------|----------|-------------|------------|------------|
| **Persistent** | Connections, state, SSE, background jobs | `routes: api` | SPA only | `dist/client/index.html` |
| **Serverless** | Stateless CRUD, isolation, scaling | Hooks only | `routes: api` | `dist/index.js` |

**Persistent** (database, gateway, authn, keyval, logs, metrics, proxy):
```typescript
// plugin.ts
export default (config): PluginImpl => ({
  routes: api,  // API here
  onInit(ctx) { db = new Pool(config.url); },
});
// index.ts - SPA only
export default { fetch: createStaticHandler(clientDir) };
```

**Serverless** (deployments):
```typescript
// plugin.ts - no routes
export default (config): PluginImpl => ({ onInit(ctx) {} });
// index.ts - API here
export default { routes: { "/api/*": api.fetch }, fetch: createStaticHandler(clientDir) };
```

## Entrypoint Modes

| entrypoint | Behavior |
|------------|----------|
| `*.html` | SPA mode - static files only, `index.ts` **NOT executed** |
| `*.js/*.ts` | Service mode - imports and executes module |

> ⚠️ **Common Mistake**: API in `index.ts` but entrypoint is `.html` → API is ignored!

## Manifest Schema

```yaml
name: "@buntime/plugin-example"
base: "/example"                    # Required, format: /[a-zA-Z0-9_-]+
enabled: true
entrypoint: dist/index.js           # Worker entrypoint
pluginEntry: dist/plugin.js         # Middleware entrypoint
dependencies: ["@buntime/plugin-database"]
optionalDependencies: []
publicRoutes:
  ALL: ["/health"]
  GET: ["/api/public/**"]
menus:
  - icon: lucide:box
    path: /example
    title: Example
env:
  MY_VAR: "value"
# Plugin-specific config (passed to factory)
myOption: "value"
```

## Environment Variables

**Naming**: `RUNTIME_*` (core), `{PLUGIN}_*` (per-plugin)

**Multiple values**: Use `:` (PATH style), NOT `,`
```bash
RUNTIME_WORKER_DIRS=/data/.apps:/data/apps  # ✅
RUNTIME_WORKER_DIRS=/data/.apps,/data/apps  # ❌
```

**Reading pattern**:
```typescript
const value = Bun.env.MY_VAR ?? pluginConfig.myVar ?? "default";
// Never: Bun.env.MY_VAR = value; ❌
```

**Workers DON'T inherit runtime env.** They receive:
- `APP_DIR`, `ENTRYPOINT`, `WORKER_ID`, `WORKER_CONFIG`
- `NODE_ENV`, `RUNTIME_*` vars
- Custom vars from `manifest.env` (sensitive patterns blocked)

## PluginImpl Interface

```typescript
interface PluginImpl {
  routes?: Hono;                    // Hono routes at /{base}/*
  middleware?: MiddlewareHandler;   // Alternative to onRequest
  server?: { routes?, fetch? };     // Static files + API in main process
  websocket?: { open?, message?, close? };

  onInit?(ctx: PluginContext): void | Promise<void>;  // 30s timeout
  onShutdown?(): void | Promise<void>;                // Reverse order (LIFO)
  onServerStart?(server): void;
  onRequest?(req, app?): Request | Response | undefined;
  onResponse?(res, app): Response;
  onWorkerSpawn?(worker, app): void;
  onWorkerTerminate?(worker, app): void;
}
```

## PluginContext

```typescript
interface PluginContext {
  config: Record<string, unknown>;    // From manifest
  globalConfig: { workerDirs, poolSize };
  logger: PluginLogger;
  pool?: WorkerPool;
  registerService<T>(name, service): void;
  getService<T>(name): T | undefined;
}
```

## Request Flow

```
Request → CSRF → runOnRequest → server.fetch → routes (Hono) → plugin app (worker) → worker apps → runOnResponse → Response
```

## Service Registry

```typescript
// Provider (declare nothing special)
ctx.registerService("database", dbService);

// Consumer (declare in dependencies!)
const db = ctx.getService<Database>("database");
```

## Security

**Blocked from workers**: `DATABASE_*`, `DB_*`, `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `AWS_*`, `GITHUB_*`, `OPENAI_*`, `ANTHROPIC_*`, `STRIPE_*`

**Reserved paths** (external plugins blocked): `/api`, `/health`, `/.well-known`

**Base path** must match: `/[a-zA-Z0-9_-]+`

## WorkerConfig

```yaml
entrypoint: index.ts
timeout: 30             # seconds or "30s"
ttl: 0                  # 0 = ephemeral
idleTimeout: 60
maxRequests: 1000
lowMemory: false
maxBodySize: "10mb"
autoInstall: false      # Use --frozen-lockfile --ignore-scripts
publicRoutes: ["/health"]
visibility: "public"    # "public" | "protected" | "internal"
env: { MY_VAR: "value" }
```

**TTL rules** (if ttl > 0): `ttl >= timeout`, `idleTimeout >= timeout`

## Hot Reload

```bash
POST /api/plugins/upload   # Upload tarball
POST /api/plugins/reload   # Rescan all
```

## Quick Checklist

- [ ] Chose ONE API mode (persistent OR serverless)
- [ ] `entrypoint` matches mode (`.html` for SPA, `.js` for service)
- [ ] Using `RUNTIME_*` / `{PLUGIN}_*` prefixes
- [ ] Using `:` separator for multiple values
- [ ] Reading: `Bun.env.X ?? config.x`
- [ ] NOT writing to `Bun.env`
- [ ] Declared dependencies in manifest
- [ ] Sensitive vars NOT in `manifest.env`
