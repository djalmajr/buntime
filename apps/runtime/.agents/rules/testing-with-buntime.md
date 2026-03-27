# Testing with Buntime

## Starting the Runtime

```bash
cd /path/to/buntime
bun dev
```

This runs all plugin builds in parallel (watch mode) and starts the runtime with hot reload.

## Environment Variables (apps/runtime/.env)

```
RUNTIME_LOG_LEVEL=info          # debug for verbose logs
RUNTIME_API_PREFIX=/_
RUNTIME_PLUGIN_DIRS="/path/to/buntime/plugins:/path/to/external-plugins"
RUNTIME_WORKER_DIRS="/path/to/buntime/apps:/path/to/edge-functions"
GATEWAY_SHELL_DIR=/path/to/edge-functions/example-spa
GATEWAY_SHELL_EXCLUDES=cpanel
```

Colon-separated paths are supported for both PLUGIN_DIRS and WORKER_DIRS.

## Full Flow

1. **Startup**: Plugins build → runtime starts → plugins load in topological order
2. **Migrations**: plugin-migrations scans apps and runs Drizzle migrations
3. **Request**: Browser → gateway (shell) → Keycloak auth → auth-token validates → proxy/worker handles

### Authentication Flow

1. Unauthenticated request → auth-token returns 401 → gateway serves example-spa
2. Front-manager fetches `/api/config/keycloak` (public proxy route → example-backend)
3. User logs in via Keycloak → example-spa sets `HYPER-AUTH-TOKEN` cookie
4. Authenticated requests → auth-token injects identity headers → worker processes

### Plugin Load Order

Topological sort based on dependencies:
1. plugin-database (no deps)
2. plugin-migrations (optional: plugin-resource-tenant)
3. plugin-keyval (depends: plugin-database)
4. plugin-gateway (no deps)
5. plugin-proxy (depends: plugin-keyval)
6. plugin-auth-token (optional: plugin-proxy)

### Worker Discovery

- Apps discovered in `RUNTIME_WORKER_DIRS`
- 3 formats: flat (`app@version/`), simple (`app/`), nested (`app/version/`)
- Each app needs `manifest.yaml` with at least `entrypoint`
- Apps mounted at `/{folder-name}/`

### Proxy Rules

Dynamic proxy rules stored in KeyVal (SQLite at `.cache/sqlite/_default.db`):
- Configure via cpanel UI: `http://localhost:8000/cpanel/redirects`
- Or API: `POST http://localhost:8000/_/api/redirects`
- Rules support `publicRoutes` for unauthenticated access
- The Demo Oxygen rule proxies `/api/*` to `backend.example.com` (needed for Keycloak config)

## Troubleshooting

- **Plugin not loading**: Check enabled in manifest.yaml, check build exists (dist/plugin.js), check dependencies loaded
- **Plugin crashes runtime**: Should not happen (loader is resilient), but check logs for exit codes
- **401 on everything**: Check auth-token loaded, Keycloak reachable, proxy rule for /api/config/keycloak is public
- **404 on worker routes**: Check worker folder in WORKER_DIRS, check manifest.yaml exists
- **500 on API**: Check DB connection, schema exists, migrations ran
- **Hot reload not picking changes**: Rebuild the plugin (`bun run build`), runtime auto-reloads
- **.env not loaded**: Must be at `apps/runtime/.env` (not buntime root)
