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
