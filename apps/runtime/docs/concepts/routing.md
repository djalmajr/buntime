# Routing

The runtime implements a multi-layer routing system that combines plugin routes, internal APIs, and worker applications.

## Routing Architecture

Route resolution order (as implemented in `app.ts`):

1. **CSRF Protection** - Origin validation for state-changing requests (POST, PUT, PATCH, DELETE)
2. **App-Shell Mode** - Intercepts navigation for shell if configured (see [Shell Routing](#shell-routing))
3. **Plugin onRequest Hooks** - Executes authentication and pre-processing hooks
4. **Runtime APIs** - `/api/*` (plugins, apps, config, health, keys, docs)
5. **Plugin server.fetch** - Request handlers from plugins with `server.fetch`
6. **Plugin Routes** - Hono routes mounted by plugins (e.g., `/keyval/*`, `/metrics/*`)
7. **Plugin Apps** - Plugin apps served via worker pool (z-frame iframes)
8. **Worker Routes** - Apps in workerDirs (e.g., `/my-app/*`)
9. **404 with Shell** - Fallback for shell to display consistent 404 page

> [!NOTE]
> The priority order ensures that more specific routes (plugins) are resolved before generic routes (workers). Plugin routes are ordered by specificity (longer paths first).

# Shell Routing

The `shouldRouteToShell()` function determines if a request should be intercepted by the app-shell:

| Condition | Behavior |
|-----------|----------|
| `Sec-Fetch-Mode` !== `"navigate"` | Rejects - non-navigation requests (fetch, XMLHttpRequest) are not intercepted |
| Path contains `/api/` | Rejects - API routes never go to shell |
| Path is `/` or empty | Accepts - homepage always goes to shell |
| Path matches plugin base | Accepts - e.g., `/metrics`, `/keyval/entries` |

Shell routing executes **after** plugin `onRequest` hooks, allowing authentication to be processed before the routing decision.

# Homepage Fallback

When a worker route returns 404 and there's a homepage configured in inline mode (`base` defined), the runtime attempts to serve the resource from the homepage app:

```
GET /unknown-app/chunk-abc.js
  1. Worker route returns 404
  2. If homepage = { app: "/cpanel", base: "/" }
  3. Tries to fetch /cpanel/chunk-abc.js
  4. If found, returns the asset
```

This allows SPAs served at the root to load assets correctly even when accessed by paths that don't correspond to specific apps.

# Worker Apps

The runtime supports worker applications with semantic versioning and automatic discovery.

## Directory Formats

The runtime supports two directory formats:

**Flat (app@version):**

```
apps/
  my-app@1.0.0/
  my-app@1.0.1/
  my-app@2.0.0/
```

**Nested (app/version):**

```
apps/
  my-app/
    1.0.0/
    1.0.1/
    2.0.0/
```

## Version Resolution

The runtime uses semver to find the correct version:

| Request | Description | Resolves to |
|---------|-------------|-------------|
| `/my-app/*` | Latest version | `2.0.0` |
| `/my-app@1/*` | Latest 1.x.x version | `1.0.1` |
| `/my-app@1.0/*` | Latest 1.0.x version | `1.0.1` |
| `/my-app@1.0.0/*` | Exact version | `1.0.0` |
| `/my-app@^1.0.0/*` | Semver range | `1.0.1` |
| `/my-app@latest/*` | Special latest tag | Directory `my-app@latest` or `my-app/latest` |

> [!NOTE]
> When no version is specified (`/my-app/*`), the runtime prefers `latest` if it exists, otherwise uses the highest semver version.

## Entrypoints

The runtime searches for entrypoints in this priority order:

1. `index.html` (served as static SPA)
2. `index.ts` (JavaScript worker)
3. `index.js` (JavaScript worker)
4. `index.mjs` (JavaScript worker)

Entrypoints can be customized in `manifest.yaml`:

```yaml
# manifest.yaml
entrypoint: server.ts
```

## Resolution Process

1. Checks if it's a plugin app (routes registered by plugins)
2. Resolves version in workerDirs using semver
3. Loads worker config (`manifest.yaml`)
4. Finds entrypoint (HTML or TS/JS)
5. Creates/reuses worker from pool
6. Injects `x-base` header with base path (`/my-app`)
7. Forwards request

## Special Headers

| Header | Description |
|--------|-------------|
| `x-base` | Base path injected by runtime for assets (e.g., `/my-app`) |
| `x-buntime-internal` | Marks request as internal (worker-to-runtime), bypasses CSRF |
| `x-not-found` | Indicates no app was found, shell should render 404 |
| `x-request-id` | Unique ID for request correlation (UUID) |

# Fallback Route

The `GET /*` route is the fallback when no other route matches:

- If `homepage` is configured in runtime: routes to homepage app
- Otherwise: returns text `"Buntime v{version}"`

Example with homepage:

```bash
GET /
# Redirects to configured homepage app
```

Example without homepage:

```bash
GET /
# Returns: "Buntime v1.0.0"
```
