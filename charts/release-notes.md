## Buntime — Changelog

### Runtime

- Worker pool with ephemeral and persistent (TTL) modes
- Plugin system with core (built-in) and external (PVC) plugins
- App-shell micro-frontend architecture with `z-frame` web component
- Configurable API prefix (`RUNTIME_API_PREFIX`)
- Multiple worker directories support (`RUNTIME_WORKER_DIRS`)
- `.env` file support for workers
- Configurable `envPrefix` for `window.__env__` injection
- Max upload size configuration with error handling

### Plugins

- **plugin-database**: Multi-adapter support (LibSQL, SQLite, PGlite), HRANA WebSocket
- **plugin-keyval**: Deno KV-like store with FTS, atomic operations, queue, watch (SSE)
- **plugin-gateway**: CORS, rate limiting, app-shell routing, dashboard with SSE metrics, shell excludes management, request logs
- **plugin-proxy**: HTTP reverse proxy with regex rules, WebSocket support, public routes, drag-and-drop rule ordering, enable/disable rules
- **plugin-deployments**: App deployment management with batch operations, multi-directory support, global excludes

### Helm Chart

- Rancher UI integration with `questions.yml`
- Versioned chart publishing with release notes
- Auto-generated values/configmap/questions from plugin manifests
- Rolling update strategy with `rollme` annotation
- PVC defaults migrated to ReadWriteMany
- Nginx proxy-body-size annotation support
- Health probes with configurable API prefix

