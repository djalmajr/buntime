## What's New in 0.3.1

### Namespaces
- **`@namespace/app` workers are URL-addressable.** A scoped worker stored at `<workerDir>/@team/app/<version>/` now serves at `/@team/app/...` (the `@` is kept). Gives teams (`@acme`, `@team`) or environments (`@staging`, `@production`) a separate context, complementing the physical multi-directory support. Unscoped workers keep serving at `/app/...`.
- **Namespace-scoped API-key permissions.** Keys carry a `namespaces` list (`["*"]` = full access, the default and the value for legacy/root keys). A restricted key only sees and manages its own `@scope` workers/plugins: the runtime 403s `NAMESPACE_DENIED` on management routes, gates uploads by the package scope, filters worker/plugin lists, and the cpanel FileBrowser hides folders the key cannot access. The key-create form gains a Namespaces field.

### Runtime
- **Enable/disable a worker or plugin without a restart.** `manifest.enabled` (default `true`) gates whether a worker version is served (`POST /api/workers/:scope/:name/:version/{enable,disable}`); plugins toggle via `POST /api/plugins/:name/{enable,disable}` with a live `server.reload()`. Disabled units 404 at their base path.
- Scope-aware filesystem path policies so drag-drop, upload, and management work correctly inside `@scope/...` folders.

### Cpanel
- Gateway and Redirects iframe headers unified with the Plugins/Workers surfaces; enable/disable surfaced as a FileBrowser dropdown action.

## What's New in 0.3.0

### Authentication
- Cookie-based admin sessions replace `?_key=` query params and `sessionStorage`. The cpanel logs in via `POST /api/admin/session`, receives an `HttpOnly + Secure + SameSite=Strict` cookie, and every subsequent request — including iframe-hosted plugin UIs — authenticates automatically. Session TTL is configurable via `RUNTIME_CPANEL_SESSION_TTL`.
- `X-API-Key` and `Authorization: Bearer` continue to work for CLI/automation callers; the credential extractor probes header first, then cookie.
- Six plugin manifests dropped their `publicRoutes: { ALL: ["/admin/**"] }` workaround now that the cookie travels with same-origin requests.

### Cpanel
- New file-browser UX for Workers and Plugins: drag-drop uploads, multi-select, batch ops, breadcrumb navigation, recursive folder upload via the FileSystemEntry API. A dedicated `<UploadArchiveButton>` routes archives through `/api/{workers,plugins}/upload` for extraction at the policy-controlled destination.
- Sidebar "Platform" group renamed to "Plugins" with consistent top-padding alignment.
- Header padding, content padding, and Reload/Upload button placement audited across Overview, Keys, Workers, Plugins, Gateway, and Redirects for a single visual rhythm.

### Runtime
- New `apps/runtime/src/libs/fs/{dir-info,path-policies}.ts` plus a `createFsRoutes` factory mounted twice (`/api/workers/files`, `/api/plugins/files`) — one storage abstraction with distinct path policies per surface (semver vs. flat layout).
- Trailing-slash 308 redirect from `/<base>` to `/<base>/` for worker apps with declared `entrypoint`.

### Plugins
- `plugin-deployments` retired. Its file-browser UX is now first-class in cpanel; its API surface lives in the runtime under `/api/{workers,plugins}/files`.
- `plugin-keyval` shipped disabled by default. Gateway and Redirects (proxy) read/write through `plugin-turso` directly — single source of state in production deployments.

### Helm chart
- **Turso questions overhaul**: the Rancher catalog form now exposes every operationally-relevant `tursoServer.*` knob. The "Turso Server" tab covers image, ports, resources, persistence, namespace lifecycle, and tokens. A new "Turso Backup" tab drives the snapshot CronJob (schedule, retention, image, S3 endpoint/bucket/region/credentials/pathStyle).
- Litestream questions kept but **marked DEPRECATED** in their descriptions. Litestream cannot coexist with `tursodb --sync-server` (file-lock contention) and replication fails silently — use the new Turso Backup tab instead.
- Default `image.repository` switched to `ghcr.io/zommehq/buntime` to match the GitLab CI pipeline. Pinned `image.tag: 0.3.0`.
