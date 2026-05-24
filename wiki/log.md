# Change Log

## [2026-05-24] feat | plugin route hot-reload (no restart) + enable/disable

### Motivation

A browser smoke test of an uploaded plugin exposed a gap: a plugin using
`server.routes` (Bun.serve native routes) appeared "loaded" after
`POST /api/plugins/reload` (registry updated, `onInit` ran) but its HTTP
routes returned 404 until a process restart. Bun's native route table is
built once at `Bun.serve()` time; the reload never rebuilt it. The user's
requirement: load uploaded plugins without a restart, and support
enable/disable at runtime.

### Root cause + fix

Three plugin HTTP surfaces reach the live server differently:
- Hono `routes` and `server.fetch` — `app.fetch` dispatches them dynamically
  from the registry per request, so they were always hot.
- `server.routes` — Bun matches these before `app.fetch` from a table fixed
  at boot, so they were stale after a reload.

Fix: `index.ts` now registers `registry.setReloadHandler(() => server.reload(...))`
with a `buildServeRoutes()` helper that re-collects `server.routes` from the
current registry. `POST /api/plugins/reload` (and the new enable/disable
routes) call `registry.reloadServerRoutes()` after `loader.rescan()`, so
native routes are rebuilt live.

### New: enable/disable endpoints

- `POST /api/plugins/:name/enable` and `/disable` (name URL-encoded; scoped
  names supported). Surgically edits the plugin's `manifest.enabled` line
  (preserving comments — not a YAML round-trip), then rescans + refreshes
  routes. Manifest is the source of truth for enabled state, so the toggle
  survives restarts. Requires `plugins:install`.

### Files

- `apps/runtime/src/plugins/registry.ts` — `setReloadHandler` + `reloadServerRoutes` (survives `clear()`).
- `apps/runtime/src/index.ts` — `buildServeRoutes()` + reload handler wiring; dropped the `hasPluginRoutes` boot conditional.
- `apps/runtime/src/routes/plugins.ts` — reload triggers `reloadServerRoutes`; new enable/disable routes + `setManifestEnabled`/`findPluginDir` helpers.
- Tests: `registry.test.ts` (reload handler) + `plugins.test.ts` (enable/disable manifest edit, comment preservation, reload trigger, 404). Suite 2729/0.

### cpanel UI

- A "Manage plugins" list (`apps/cpanel/src/components/admin/tabs/plugin-manager.tsx`)
  sits above the file-browser in the Plugins tab. It lists every installed
  plugin (built-in + uploaded), shows enabled state (= present in the loaded
  set), and a one-click enable/disable toggle backed by `setPluginEnabled()`.
  The file-browser is the wrong surface for this (it only shows uploaded
  plugins; built-ins live in the hidden `.plugins` dir), hence the dedicated
  list. Browser-verified: disabling removes the plugin's sidebar menu + routes
  live; enabling restores them — no restart.

---

## [2026-05-23] fix | scope-aware FileBrowser path policies

### Motivation

The path policies in `apps/runtime/src/libs/fs/path-policies.ts` and the
client mirror at `apps/cpanel/src/components/file-browser/path-policy.ts`
used the first path segment as the unit name. For npm-scoped names
`@scope/name`, that meant:

- Workers: `@scope/foo/1.0.0/` was rejected — `@scope` was treated as the app
  name and `foo` failed the semver check, so `unitRoot` was null and
  `canWriteAt` returned false. Drag-drop into scoped worker version folders
  was unusable.
- Plugins: `@scope/foo/` was misidentified — `@scope` was treated as the
  plugin name and `foo` as something inside it. Writes worked (free-form
  policy) but `isUnitRoot` returned false at `@scope/foo`, so DirInfo did
  not detect the manifest there.

The `<UploadArchiveButton>` install path was unaffected (server uses
`parsePackageName` correctly), but drag-drop and the FileBrowser's badge
detection were broken for scoped paths.

### What changed

- Both `workersPathPolicy` and `pluginsPathPolicy` now detect `@scope` as
  the first segment and consume one extra segment for the unit name. Unit
  root, `canWriteAt`, `isUnitRoot`, and `isInsideUnit` all shift their math
  accordingly. The implementation replaces depth-based comparisons with a
  string-equality check against the parsed `unitRoot`, which is simpler and
  inherently correct regardless of segment count.
- `apps/cpanel/src/components/file-browser/path-policy.ts` mirrors the same
  scope-aware logic, plus `validateFolderName` and `folderHints` now offer
  sensible UX at `@scope/<here>` (the name slot of a scoped unit).
- Tests: `path-policies.test.ts` extended with 14 scoped cases covering both
  workers (nested + flat) and plugins. Updated the legacy
  `parseDeploymentPath("@scope/app@1.0.0")` and `extractAppName(...)` tests
  to reflect that `@scope/app` is now recognised as a single name.

### Verification

- `bun test apps/runtime/src/libs/fs/path-policies.test.ts` — 78/0 (was
  70/0 before the new cases).
- `bun test` — 2723/0 across the suite.
- `bun run lint` — clean.

---

## [2026-05-23] docs | upload archive contract + FileBrowser path-policy scope limitation

### Motivation

User asked what the upload zip expects for workers vs plugins, and whether
uploading while browsing inside a version folder or scoped plugin folder
(`@scope/name`) creates correctly. The wiki only mentioned `package.json with
name and version` in passing — missing `manifest.yaml` priority, the version
default, `package/` prefix auto-strip, scoped-name layout, and the difference
between the two upload mechanisms in the cpanel FileBrowser.

While documenting, surfaced a real bug: `workersPathPolicy` and
`pluginsPathPolicy` use the first path segment as the unit name and do not
recognise `@scope/name` as a single unit. The explicit Upload button bypasses
this (server uses `parsePackageName` correctly), but drag-drop into a scoped
folder is broken for workers and partially broken for plugins.

### What changed

- `wiki/apps/runtime-api-reference.md` — `/api/workers/upload` and
  `/api/plugins/upload` sections expanded with the full archive contract:
  accepted extensions, internal layout (root vs `package/` prefix), manifest
  precedence (`manifest.yaml` > `manifest.yml` > `package.json`), required vs
  optional fields, version default (`"latest"`), and the layout tables for
  scoped vs unscoped names.
- `wiki/apps/cpanel.md` — new section "File-browser — two upload paths, two
  contracts" distinguishing `<UploadArchiveButton>` (path-agnostic install)
  from drag-drop via `/api/{workers,plugins}/files/upload` (path-policy
  gated). Documents the `@scope/name` policy bug with a comparison table.
- `CLAUDE.md` — new rule "Wiki-as-canonical-source — gap detection": if a
  user question cannot be answered from the wiki, that question's content is
  a wiki candidate. Update the wiki in the same turn, log, reindex.

### Verification

- `qmd --index buntime query "upload archive zip plugin worker"` (post-embed)
  → should hit the new sections.

---

## [2026-05-22] deploy | home-workload v0.3.0 (cookie auth + file-browser + Turso questions overhaul)

### Motivation

Validate end-to-end the v0.3.0 surface — cookie-based admin sessions, file-browser absorption, `plugin-deployments` retirement, `plugin-keyval` default-off, and the completed Turso questions tab — on the real `home-workload` k3s cluster (3 nodes, k3s 1.35.4 @ 192.168.252.{2,3,4}). The previous deploy from task #75 was at chart 0.2.26 / appVersion 1.1.0; this lifts the cluster to 0.3.0 / 1.2.0 with a runtime image rebuilt from current HEAD.

### What changed (vs cluster state before this deploy)

- **Helm release `buntime`**: revision 1 → 5 (revisions 2-4 failed before image landed; 5 succeeded after local rebuild).
- **Chart**: bumped `0.2.26 → 0.3.0`. `appVersion 1.1.0 → 1.2.0`.
- **Runtime image**: rebuilt locally and pushed `ghcr.io/zommehq/buntime:{v0.3.0,0.3.0,latest}` (digest `sha256:b0068e8a…`). The GitLab CI pipeline did not auto-publish — see "What broke" below.
- **No data loss**: existing PVCs (`buntime-apps`, `buntime-plugins`, `state-buntime-0`, `data-buntime-turso-0` on `local-path`) preserved. Smoke tokens (`smoke-root-key`, `data-token-123`, `admin-token-456`) carried over via `--reuse-values`.
- **Backup**: disabled in this deploy (`tursoServer.backup.enabled=false`) — MinIO bucket `buntime-turso-backups` not yet created. MinIO namespace exists; bucket bootstrap is a follow-up.

### Process notes

- **Image-pull secret name mismatch**: the existing cluster uses `gitlab-registry-pull`, not the `gitlab-home` name from the plan. Overlay matched the actual cluster name.
- **StorageClass mismatch**: the cluster only has `local-path` (k3s default); plan assumed `longhorn` (not installed). Overlay switched to RWO + `local-path` at 2Gi (apps/plugins). Multi-pod across nodes will require Longhorn or NFS — out of scope for this deploy.
- **PVC label conflict on first upgrade**: rev 1 PVCs had `kubectl-client-side-apply` field-managed labels (`app.kubernetes.io/version`, `helm.sh/chart`) that conflicted with Helm 4's server-side apply. Fix: `helm upgrade ... --force-conflicts` to transfer ownership.
- **Service selector overlap**: `service/buntime` selector matches BOTH `buntime-0` and `buntime-turso-0`. `kubectl port-forward svc/buntime` picks turso randomly; use `pod/buntime-0` for smoke. Chart-level fix is a follow-up (add `component: runtime` selector to runtime service, `component: turso-server` to turso services).

### What broke

- **GitLab CI did not publish the v0.3.0 image**. Pipeline registration on the `runtime-performance-resilience` branch + `v0.3.0` tag yielded no new tags in `ghcr.io/zommehq/buntime` (only `latest` predating the work). Root cause unknown — likely missing runner registration or rule mismatch on the project. Worked around by `docker build + push` from the developer mac. Investigation tracked as follow-up.
- **GitHub mirror push deferred** — user explicitly requested "no GitHub during the testing phase". Branch + tag live only on `gitlab.example.com` for now.

### Smoke results (via `kubectl port-forward pod/buntime-0 18000:8000`)

- `POST /_/api/admin/session` with `Content-Type: application/json` + `Origin` header + `{"key":"smoke-root-key"}` → **HTTP 200** with `set-cookie: buntime_api_key=…; Max-Age=86400; HttpOnly; SameSite=Strict`. Response body includes principal + permissions.
- `DELETE /_/api/admin/session` with `Origin` → **HTTP 204** with `set-cookie: buntime_api_key=; Max-Age=0` (cookie cleared).
- `POST` without `Content-Type: application/json` → **HTTP 400** "Request body must be JSON".
- `POST` without `Origin` header → **HTTP 403** "Forbidden - Origin required" (CSRF gate active).
- `GET /_/api/plugins/loaded` → 3 plugins: `@buntime/plugin-turso`, `@buntime/plugin-gateway`, `@buntime/plugin-proxy`. **No `plugin-keyval`** — disabled-by-default flag honored at load time.
- `GET /_/api/workers/files/list?path=` → mount root listing (`apps/` directory present).
- `GET /_/api/plugins/files/list?path=` → mount root listing (`plugins/` directory present).
- Pod logs confirm: turso multi-tenant namespaces `runtime`, `gateway`, `proxy` all connected against `http://buntime-turso:8080`. No keyval references.

### Deploy artifacts committed

- `deploy/values.home-workload.yaml` — overlay matching real cluster topology.
- `deploy/install-home-workload.sh` — one-shot installer (untracked; for manual operator use).
- `charts/templates/configmap.yaml` regenerated to drop stale `plugins.deployments.excludes` reference left over from the retired plugin.

### Follow-ups

- Debug + fix GitLab CI pipeline so subsequent pushes auto-publish without manual `docker build`. Likely runner registration or `image:build` rules tweak.
- Provision MinIO bucket `buntime-turso-backups` and flip `tursoServer.backup.enabled=true`. Re-verify daily snapshot CronJob in v0.3.1.
- Split the chart's runtime vs turso-server selector labels (currently both share the same selector → service ambiguity).
- When Longhorn or NFS lands on the lab, switch persistence to RWX and lift `replicaCount` to 2+ to exercise the sync-mode multi-pod path the chart was designed for.

---

## [2026-05-21] apps | absorb plugin-deployments into cpanel; rename Platform → Plugins

### Motivation

`plugin-deployments` shipped a polished file-browser (breadcrumbs, multi-select, drag-drop with recursive folder upload, rename/move/delete dialogs, search, visibility badges, batch ops, downloads, zip auto-extract) but it duplicated capabilities already present in the runtime's worker/plugin install endpoints. The cpanel's own Workers/Plugins admin tabs, by contrast, were simple tables — far worse UX than the plugin's micro-frontend. The user asked: keep the great UX, drop the duplication, and **apply the same browser to both** the workers directory AND the plugins directory.

A secondary cleanup: the sidebar section "Platform" was a vague label for "everything contributed by plugins" — rename it to "Plugins" to match how operators actually think about those entries.

### What changed

**Server (`apps/runtime`)**
- New `apps/runtime/src/libs/fs/dir-info.ts` — ported as-is from `plugins/plugin-deployments/server/libs/dir-info.ts`. Now takes a `PathPolicy` so the same class can drive both surfaces.
- New `apps/runtime/src/libs/fs/path-policies.ts` — exports `workersPathPolicy` (semver-aware: `{name}/{version}/...` or flat `{name}@{version}/...`; uploads must target a version folder; moves must originate strictly inside it) and `pluginsPathPolicy` (free-form: any path inside a plugin folder is writable).
- New `apps/runtime/src/routes/fs.ts` — `createFsRoutes({ resolveDirs, pathPolicy })` factory exposing the 13 endpoints (`list`, `mkdir`, `rename`, `move`, `delete`, `upload`, `refresh`, `download`, `delete-batch`, `move-batch`, `download-batch`).
- `apps/runtime/src/api.ts` mounts the factory twice:
  - `/api/workers/files/*` → `runtimeConfig.workerDirs`, workers policy
  - `/api/plugins/files/*` → `runtimeConfig.pluginDirs`, plugins policy
- No new auth middleware — the runtime gate at `app.ts` already authenticates the cookie/header for `/api/*`. Existing `requiredPermissionForApiRoute()` covers the new paths via prefix-match on `/workers/` and `/plugins/`.
- Tests ported: `apps/runtime/src/libs/fs/{dir-info,path-policies}.test.ts` (54 + 70 cases) and a new `apps/runtime/src/routes/fs.test.ts` (33 cases) that parametrizes the same scenarios across both mounts.

**Cpanel (`apps/cpanel`)**
- New `apps/cpanel/src/helpers/fs-api.ts` — typed client (`workersFsApi`, `pluginsFsApi`) composing on top of `runtimeFetch` (cookie auth).
- New `apps/cpanel/src/components/file-browser/` module — `<FileBrowser api policy routePath canWrite headerExtra />`, with the ported `FileRow`, `SelectionToolbar`, dialogs (`NewFolderDialog`, `RenameDialog`, `MoveDialog`, `ConfirmDeleteDialog`), and a client-side `ClientPathPolicy` mirroring the server's policy semantics.
- Replaced `apps/cpanel/src/components/admin/tabs/{workers,plugins}.tsx` — old tables removed. `WorkersTab` is now a 25-line wrapper around `<FileBrowser>`; `PluginsTab` adds a Reload button via `headerExtra` (still calls `POST /api/plugins/reload`).
- Iframe-specific bits dropped (`use-fragment-url`, Frame SDK). URL state moves to TanStack Router `?path=` search params via `validateSearch` in `apps/cpanel/src/routes/{workers,plugins}.tsx`.
- Missing UI primitives (`checkbox`, `dialog`, `dropdown-menu`) copied into `apps/cpanel/src/components/ui/`. Radix deps were already present.

**Sidebar (`apps/cpanel`)**
- `SidebarNavGroup` gained an optional `className` field; `NavMain` accepts `groupClassName` and forwards it to `<SidebarGroup>`.
- `apps/cpanel/src/routes/__root.tsx` — renamed the second group from `t("nav.platform")` to `t("nav.plugins")` and added `className: "mt-4"` for visual breathing room. The Runtime group's "Plugins" item (install/manage page) coexists with the section heading by hierarchy.
- Dropped the now-unused `nav.platform` key from `locales/{en,pt}.json`.

**Cleanup**
- `rm -rf plugins/plugin-deployments/` — the entire plugin module. No production imports anywhere; only doc comments and historical references remain in the codebase.
- `wiki/apps/plugin-deployments.md` deleted.
- `wiki/index.md`, `wiki/apps/{cpanel,plugin-auth-boundary,plugin-system}.md` updated.

### Verification

- `bun test` — **2699 / 0 fail** across 97 files (was 2892 before deletion; -193 from deleted plugin tests).
- `bun run lint` — clean on all workspaces.
- `bun run build` — cpanel + every remaining plugin builds.
- Manual browser smoke pending the next session.

### Files

| Type | Path |
|---|---|
| Create | `apps/runtime/src/libs/fs/dir-info.ts` (+ test) |
| Create | `apps/runtime/src/libs/fs/path-policies.ts` (+ test) |
| Create | `apps/runtime/src/routes/fs.ts` (+ test) |
| Modify | `apps/runtime/src/api.ts` (mount `/workers/files`, `/plugins/files`) |
| Create | `apps/cpanel/src/helpers/fs-api.ts` |
| Create | `apps/cpanel/src/components/file-browser/**` (index, dialogs, file-row, selection-toolbar, path-policy) |
| Create | `apps/cpanel/src/components/ui/{checkbox,dialog,dropdown-menu}.tsx` |
| Modify | `apps/cpanel/src/components/admin/tabs/{workers,plugins}.tsx` (file-browser wrappers) |
| Modify | `apps/cpanel/src/routes/{workers,plugins}.tsx` (`validateSearch`) |
| Modify | `apps/cpanel/src/components/{main-layout,nav-main}.tsx` (`groupClassName`) |
| Modify | `apps/cpanel/src/routes/__root.tsx` (`nav.platform` → `nav.plugins` + `mt-4`) |
| Modify | `apps/cpanel/src/routes/locales/{en,pt}.json` (drop `nav.platform`) |
| Delete | `plugins/plugin-deployments/` (entire directory) |
| Delete | `wiki/apps/plugin-deployments.md` |
| Modify | `wiki/{index,apps/cpanel,apps/plugin-auth-boundary,apps/plugin-system}.md` |

## [2026-05-21] apps | cpanel auth migration: HttpOnly cookie replaces sessionStorage + X-API-Key

### Motivation

Two related problems with the previous design:

1. **XSS exfiltration.** The cpanel stored the operator key in `sessionStorage['buntime:cpanel-api-key']` and stamped it into `X-API-Key` on every fetch. Any script that landed on the cpanel could read the key trivially and exfiltrate it — and that key opens full admin against the runtime and every core plugin.
2. **Iframe authentication was broken.** The cpanel sidebar entries under "Platform" (Gateway, Redirects, KeyVal, Deployments) load plugin micro-frontends via `<z-frame src="/<base>/">`. Iframes cannot inject `X-API-Key` headers, so the requests arrived without credentials, `plugin-authn` 401'd, and every Platform tab showed `{"error":"Unauthorized"}`. The `publicRoutes: { ALL: ["/admin/**"] }` workaround in 6 plugin manifests never actually fired from cpanel because the iframe URL was `/<base>/`, not `/<base>/admin/...`.

User push during the cpanel browser smoke test: *"mas a key nao seria capturada em loggers? Por que nao usamos cookies?"* and *"Por que nao removemos sessionstorage tambem?"* — drove the move to a server-issued HttpOnly cookie.

### What changed

- **Server: `POST /api/admin/session`** validates the key (`RUNTIME_ROOT_KEY` or `ApiKeyStore`) and issues `Set-Cookie: buntime_api_key=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` (`Secure` on HTTPS). `DELETE /api/admin/session` clears it. `GET /api/admin/session` now accepts the cookie too.
- **Server: `RUNTIME_CPANEL_SESSION_TTL` env var** (default `24h`, parsed by `parseDurationToMs`) controls cookie lifetime.
- **Shared middleware: `extractApiKey`** priority is now `X-API-Key` → `Authorization: Bearer` → cookie `buntime_api_key`. The `?_key=` query-string fallback is **removed completely** — it leaked credentials into URLs, access logs, and the Referer header.
- **Runtime gate (`apps/runtime/src/app.ts`)** now imports the shared extractor — adding cookie support there means every plugin `onRequest` hook (including `plugin-authn`) is correctly bypassed for cpanel iframe requests.
- **Cpanel client (`apps/cpanel/src/contexts/api-key-auth-context.tsx`)** — all `sessionStorage` references removed. `authenticate(key)` POSTs to the session endpoint, `logout()` DELETEs, `refresh()` GETs. The raw key never enters React state. The legacy `buntime:admin-api-key` migration is gone too.
- **Cpanel api-client (`apps/cpanel/src/helpers/api-client.ts`)** — `apiKey` option dropped. `fetch` calls send `credentials: "same-origin"`. Every caller (`getAdminSession`, `listApiKeys`, `listWorkers`, `listInstalledPlugins`, `listLoadedPlugins`, `createApiKey`, `revokeApiKey`, `uploadPlugin`, `reloadPlugins`, `deletePlugin`, `uploadWorker`, `deleteWorker`, `deleteWorkerVersion`) updated.
- **`packages/shared/src/client/api-key.ts` deleted** along with its export entries in `package.json` and `jsr.json`. Plugin clients (`plugin-gateway`, `plugin-authz`, `plugin-deployments`, `plugin-logs`, `plugin-metrics`, `plugin-proxy`) switched to plain `fetch(url, { credentials: "same-origin" })` and `new EventSource(url)` — same-origin EventSource sends cookies automatically, no `?_key=` URL stuffing.
- **Plugin manifests cleanup** — `publicRoutes: { ALL: ["/admin/**"] }` removed from `plugin-authn`, `plugin-authz`, `plugin-deployments`, `plugin-gateway`, `plugin-logs`, `plugin-proxy`. `plugin-metrics` keeps `publicRoutes: { GET: ["/prometheus"] }` — Prometheus scrape must be reachable without credentials.

### Wiki updates

- [`wiki/apps/plugin-auth-boundary.md`](./apps/plugin-auth-boundary.md) — rewritten. Title shifted from "control plane vs data plane via /admin/**" to "Operator credentials: header for CLI, cookie for browser". Documents the three transport channels and the runtime gate that bypasses plugin hooks.
- [`wiki/apps/cpanel.md`](./apps/cpanel.md) — "Authentication (cpanel-wide)" section rewritten. Documents the cookie issuance, lifetime config, and the security guarantees (HttpOnly, SameSite=Strict, Secure on HTTPS).
- [`wiki/apps/runtime-api-reference.md`](./apps/runtime-api-reference.md) — new "Admin Session" section documents `GET/POST/DELETE /api/admin/session` and the `RUNTIME_CPANEL_SESSION_TTL` env var.

### Tests

- `packages/shared/src/middleware/api-key.test.ts` — 7 new cases: cookie extraction (alone, mixed with other cookies, with various priority orderings), regression that `?_key=` no longer authenticates, full middleware authentication via cookie.
- `apps/runtime/src/routes/admin.test.ts` — rewritten. 15 cases covering `GET /admin/session` (rejects no creds; root key; bearer; cookie), `POST /admin/session` (issues cookie for root key + generated key; rejects invalid key; rejects malformed/missing body; marks Secure on HTTPS only; honors `RUNTIME_CPANEL_SESSION_TTL`), `DELETE /admin/session` (clears cookie via `Max-Age=0`; idempotent on cookie-less request).
- Fixed two pre-existing config-mock spies (`request.test.ts`, `libs/pool/config.test.ts`) that were leaking across test files — added `mockRestore` in `afterEach` and included the new `cpanelSessionTtlMs` field in the mocks.
- Fixed two pre-existing `ConstructorParameters<typeof ApiKeyStore>` typecheck failures in `api-keys.test.ts` (private constructor) by switching to `Parameters<typeof ApiKeyStore.__forTests>[0]`.

### Verification

- `bun test` — **2744 pass / 0 fail** across 98 files.
- `bun run lint` — clean on every workspace (biome + tsc).
- Manual browser smoke test pending the next session.

### Files touched

| Type | Path |
|---|---|
| Modify | `packages/shared/src/middleware/api-key.ts` (cookie extraction; `?_key=` removed) |
| Modify | `packages/shared/src/middleware/api-key.test.ts` (new cases) |
| Modify | `packages/shared/package.json` + `jsr.json` (drop `./client/api-key` export) |
| Delete | `packages/shared/src/client/api-key.ts` (whole module + folder) |
| Modify | `apps/runtime/src/app.ts` (use shared extractor) |
| Modify | `apps/runtime/src/config.ts` (`cpanelSessionTtlMs` field) |
| Modify | `apps/runtime/src/routes/admin.ts` (POST + DELETE endpoints) |
| Modify | `apps/runtime/src/routes/admin.test.ts` (new test suite) |
| Modify | `apps/runtime/src/api.ts` (wire `rootKey` into admin routes) |
| Modify | `apps/runtime/src/utils/request.test.ts` (mock leak fix) |
| Modify | `apps/runtime/src/libs/pool/config.test.ts` (mock leak fix) |
| Modify | `apps/runtime/src/libs/api-keys.test.ts` (private-ctor typecheck fix) |
| Modify | `apps/cpanel/src/contexts/api-key-auth-context.tsx` (sessionStorage removed) |
| Modify | `apps/cpanel/src/helpers/api-client.ts` (drop `apiKey` option) |
| Modify | `apps/cpanel/src/helpers/admin-api.ts` (drop `apiKey` arg from every function; add `loginAdminSession`/`logoutAdminSession`) |
| Modify | `apps/cpanel/src/components/auth/api-key-login.tsx` (doc comment) |
| Modify | `apps/cpanel/src/components/admin/tabs/{keys,plugins,overview,workers}.tsx` (callers updated) |
| Modify | `plugins/plugin-{gateway,authz,deployments,logs,metrics,proxy}/client/**` (drop shared helpers; use `fetch` with `credentials: "same-origin"`) |
| Modify | 6 plugin manifests — remove `publicRoutes: { ALL: ["/admin/**"] }` |
| Modify | `wiki/apps/plugin-auth-boundary.md`, `wiki/apps/cpanel.md`, `wiki/apps/runtime-api-reference.md` |

## [2026-05-21] ops | turso-server hot backup + Litestream removal + multi-node smoke test

End-to-end backup story for the multi-tenant turso-server, validated on
the `home-workload` cluster (3-node k3s, MinIO already deployed).

### Litestream is incompatible with `tursodb --sync-server`

Confirmed empirically: Litestream's `sqlite3` connection cannot acquire
any lock on a file held exclusively by `tursodb` (CDC + MVCC). Symptom
is `database is locked (5) (SQLITE_BUSY)` in a tight loop with **zero
bytes** reaching the bucket. Hot backups via the binary's own
`.dump`/`.backup`/`VACUUM INTO` from a second process also fail for
the same reason — every external attempt to read the file gets
`Locking error: Failed locking file`.

Action: kept the chart switch `tursoServer.litestream.enabled` for
operators to experiment with future Litestream/tursodb versions but
defaulted to `false` and added a prominent "does NOT work" note in
[`wiki/ops/turso-server.md`](./ops/turso-server.md#why-litestream-does-not-work-here).

### Hot-backup endpoint on turso-server (`VACUUM INTO`)

The supervisor already owns the live `tursodb` connection that holds
the lock. `VACUUM INTO` runs **inside** that connection — no second
process, no lock contention, fully consistent. New code:

- **`apps/turso-server/internal/server/backup.go`**: issues
  `VACUUM INTO '<dest>'` via the Hrana pipeline endpoint on the
  internal port of the running `tursodb`. Parses the response, returns
  the snapshot path.
- **Admin route `GET /v1/namespaces/:name/backup`**: runs the
  snapshot, streams the `.db` body to the client, removes the temp
  file. Content-Type `application/vnd.sqlite3`, suggested filename
  via `Content-Disposition`. Lives in `admin.go`.
- Verified in cluster: produces a valid SQLite file (header
  `53 51 4c 69 74 65 20 66 6f 72 6d 61 74 20 33 00`), readable by a
  standalone `tursodb` shell.

### Backup CronJob (replaces the Litestream sidecar)

- **`charts/templates/turso-server-backup-cronjob.yaml`**: daily
  CronJob enumerates namespaces via the admin API, downloads each
  snapshot, pipes it into S3 via `mc pipe`. Per-namespace retention
  (default 14 snapshots) with reverse-sorted timestamp pruning.
- **`charts/values.base.yaml`** new block `tursoServer.backup.*` with
  `enabled`, `schedule`, `image`, `retentionCount`, S3 endpoint /
  bucket / region / credentials.
- **`charts/templates/secret.yaml`**: new `-backup` Secret holding the
  S3 access key id / secret.
- **`charts/questions.base.yaml`**: 8 new Rancher UI questions for the
  backup controls.

### Custom slim image for the CronJob (`apps/turso-server/backup.Dockerfile`)

Official `minio/mc` is shell-less (no `/bin/sh`, no `awk/grep`, no
`curl`); the CronJob's loop needed a real environment. Built a small
alpine-based image bundling `mc` + `curl` + `jq` + `bash`:

- **`apps/turso-server/backup.Dockerfile`** → published as
  `ghcr.io/zommehq/turso-backup:0.1.0` (~30 MB, multi-arch).
- The Dockerfile fetches the `mc` binary from `dl.min.io` matching the
  build's `TARGETARCH`.

### Subprocess lifetime fix in the supervisor

Found during the multi-node smoke that newly auto-created namespaces
were getting SIGKILL'd seconds after spawn. Root cause:
`exec.CommandContext` was bound to the HTTP-request context — when the
auto-provision request returned, the request context was cancelled and
the child tursodb process was killed. Fix:

- **`apps/turso-server/internal/server/supervisor.go`**: spawn child
  processes with a supervisor-scoped context (`procCtx`) cancelled
  only when `Supervisor.Stop` runs. The caller's `ctx` is still
  honored by `waitForPort`, so a cancelled caller still abandons its
  wait — the process keeps running for the next caller.
- Image bumped to `ghcr.io/zommehq/turso-server:0.1.1`
  (and `0.2.0` for the version that adds the backup endpoint).

### Litestream initContainer command shape

Even though the sidecar will not work in production, the chart still
wires the restore initContainers correctly so the switch is testable
in isolation. Two issues fixed during the smoke:

- The `litestream/litestream` image is distroless (no `/bin/sh`),
  which broke the prior shell-loop init container. Replaced with a
  per-database initContainer that calls the litestream binary
  directly (no shell required).
- Argument order: `-config` is a flag of the `restore` **subcommand**,
  not a global flag. Corrected.

### End-to-end smoke (`rancher.home/c-h7clt` cluster, 3-node k3s)

- 1× `buntime-turso-0` + 1× `buntime-0` pod, both Running.
- 5 namespaces auto-created (api-keys, runtime, gateway, proxy,
  keyval), all visible via admin API.
- Inserted keys via the runtime; backup CronJob run manually:
  - 5 hot snapshots produced in ~1.5 s with zero downtime.
  - MinIO bucket `turso-backups` shows
    `<ns>/<ns>-<utcts>.db` for each namespace, total ~44 KB.
- Verified each snapshot is a real SQLite file (standalone `tursodb`
  shell reads the rows back).

### Restore: works offline, gap on live cluster

Confirmed that the snapshot files contain all rows and the schema
(read with a separate `tursodb` shell). Live cluster restore has a
**known gap**: `VACUUM INTO` copies data but not the CDC log, so
sync clients connecting after restore see the rows in the table but
the sync engine reports no changes to pull. Tracked in
[`wiki/ops/turso-server.md#restoring`](./ops/turso-server.md#restoring)
as a follow-up; offline data recovery (which is the primary DR use
case) works fully.

### Files

- New: `apps/turso-server/internal/server/backup.go`
- New: `apps/turso-server/backup.Dockerfile`
- New: `charts/templates/turso-server-backup-cronjob.yaml`
- Modified: `apps/turso-server/internal/server/{supervisor,admin}.go`
- Modified: `charts/templates/{turso-server.yaml,turso-server-litestream-config.yaml,secret.yaml}`
- Modified: `charts/{values,questions}.base.yaml`
- Modified: `wiki/ops/{turso-server.md,multi-pod-deployment.md}`
- Modified: `wiki/apps/plugin-turso.md`

### Verification

```sh
go test ./apps/turso-server/... 2>&1 | tail -3
bun test 2>&1 | tail -3
bun run lint
helm lint ./charts
```

All clean. 2 715 Bun tests pass; 24 Go tests pass.

## [2026-05-21] apps + ops | multi-tenant turso-server (Go) for dynamic namespaces

New app: [`apps/turso-server/`](../apps/turso-server/), a Go supervisor
that wraps the official `tursodb --sync-server` binary and exposes the
namespace lifecycle semantics of `sqld`. This closes the multi-database
gap that blocked the multi-pod deployment from going beyond a single
shared database.

### Why

`tursodb --sync-server` (v0.6.0) serves exactly one database per
process. The lowcode platform needs each user app to provision its own
database dynamically at runtime — explicit `helm upgrade`-per-app is not
viable. The wrapper supervises N `tursodb` processes inside a single Pod
and proxies clients into them by URL path, so the client experience is
identical to `sqld`: `libsql://server/<namespace>` works, namespaces
appear/disappear via REST, and `@tursodatabase/sync` continues as the
client driver.

### What was built

- **`apps/turso-server/`** — Go module (compiles to a 9 MB static binary)
  with:
    - `main.go`: bootstraps config, store, supervisor, GC, and the two
      HTTP listeners (data + admin); handles SIGTERM-driven graceful
      shutdown.
    - `internal/server/config.go`: env-driven configuration loader plus
      namespace name validation (`^[a-z0-9][a-z0-9_-]{0,62}$`).
    - `internal/server/state.go`: persistent `_state/namespaces.json`
      registry with atomic writes and a 60 s debounce flusher for the
      hot `lastAccessAt` updates.
    - `internal/server/supervisor.go`: `tursodb` subprocess lifecycle —
      port allocation in 9000-9999, `waitForPort` after spawn, per-name
      mutex for serialized auto-create, reaper goroutine that frees the
      port when a backend exits unexpectedly.
    - `internal/server/proxy.go`: namespace-aware reverse proxy on the
      data port using `net/http/httputil.ReverseProxy`. Strips the
      `/<namespace>` prefix, forwards to the internal port, bumps
      `lastAccessAt`. Returns 404 with `auto_provision=false`.
    - `internal/server/admin.go`: REST API on the admin port —
      `POST /v1/namespaces/:name/create`, `DELETE …/:name`, list,
      lock/unlock/ttl/access.
    - `internal/server/auth.go`: constant-time `Authorization: Bearer`
      check; `/healthz` and `/readyz` bypass auth so kubelet probes work
      without credentials.
    - `internal/server/gc.go`: background sweeper. Archives auto-created
      namespaces idle longer than `TURSO_AUTO_IDLE_DURATION` (default
      7 d) and TTL-expired ones; deletes archive entries older than
      `TURSO_ARCHIVE_RETENTION` (default 30 d). Locked namespaces are
      always preserved.
    - Tests: 24 Go tests covering state persistence, namespace
      validation, proxy forwarding, auth, admin routes, and GC.
- **`apps/turso-server/Dockerfile`** — multi-stage build (`golang:1.26-alpine`
  → `debian:bookworm-slim`) that pulls `tursodb` from the official
  GitHub release tarball, verifies it boots, and packs both binaries
  into a 211 MB image. Multi-arch (linux/amd64, linux/arm64).

### Wider repo wiring

- **`charts/`** — replaced the `tursoPrimary` block with `tursoServer`:
  - `values.base.yaml`: new image (`ghcr.io/zommehq/turso-server`),
    two tokens (`authToken`, `adminToken`), `autoProvision`,
    `maxNamespaces`, GC tunables.
  - `templates/turso-server.yaml`: 1-replica StatefulSet, two ClusterIP
    Services (data + admin), Secret with both tokens, HTTP probes
    (replacing the noisy `tcpSocket` probes on the old chart).
  - `templates/turso-server-litestream-config.yaml`: Litestream now
    globs `/var/lib/turso/*.db` so newly-created namespaces are
    replicated automatically (no helm upgrade needed when apps
    provision their own databases).
  - `configmap.base.yaml`: `RUNTIME_AUTH_DB_SYNC_URL` points at
    `…/turso:8080/api-keys` (the namespace path is the database name);
    new `TURSO_SERVER_URL` and `TURSO_SERVER_ADMIN_URL` exported to
    all pods.
  - `secret.yaml`: separate `TURSO_SERVER_TOKEN` (data plane) and
    `TURSO_SERVER_ADMIN_TOKEN` (admin plane) so workers never receive
    the admin token.
  - `questions.base.yaml`: 11 new questions for Rancher UI covering
    the lifecycle policy knobs.
- **`plugins/plugin-turso/`** — multi-tenant mode:
  - New `server` config block (URL + token). When `TURSO_SERVER_URL`
    is set, the plugin switches to multi-tenant mode.
  - `TursoServiceImpl` maintains `Map<namespace, TursoAdapter>` and
    opens one embedded replica per `connect(namespace)`. Concurrent
    first-touches for the same namespace are deduplicated via an
    in-flight Promise.
  - Each adapter is wired to `<server.url>/<namespace>` with the local
    replica file co-located in the configured `localPath` directory.
  - `transaction({type:"concurrent"})` is downgraded to
    `BEGIN DEFERRED` automatically when running against a sync replica
    — `tursodb` rejects MVCC transactions on CDC-enabled databases.
- **`packages/shared/src/api-keys.ts`** — `PRAGMA journal_mode = mvcc`
  now runs only in `mode=local`. Sync replicas use the WAL mode the
  primary chose (sync needs CDC, which is incompatible with MVCC).

### Validation

- All 2 715 `bun test` cases continue to pass.
- 24 Go unit tests pass (`go test ./...`).
- Container smoke (local docker, arm64):
    1. `docker run` the image → both ports up
    2. `POST /v1/namespaces/foo/create` → 201, file `foo.db` appears
       on disk
    3. Auto-create via `/auto-app/...` → namespace materialised
    4. Restart container → both namespaces respawn
- E2E with the `@tursodatabase/sync` driver:
    1. Two replicas pointed at the same namespace
    2. Replica 1 creates schema + row + `push()`
    3. Replica 2 `pull()` → sees the row
- Cluster smoke (rancher.home, 3 pods + 1 turso-server pod):
    1. 5 namespaces auto-provisioned (api-keys, runtime, gateway,
       proxy, keyval) — one per consumer
    2. Key created on pod-0 → visible on pod-1 and pod-2 within one
       sync interval (60 s default)
    3. Admin REST callable from inside the cluster (Service + Secret
       wiring works)

### Known limitations

- One `tursodb` process per namespace — RAM grows linearly. 256
  default cap (`TURSO_MAX_NAMESPACES`).
- Single replica StatefulSet — no HA. Rely on Litestream for DR.
- No metrics endpoint yet (counters are internal). Prometheus follow-up.
- Admin port is bearer-token only — pair with a `NetworkPolicy` to
  restrict to the runtime ServiceAccount in shared clusters.

### Files

- New: `apps/turso-server/{go.mod,main.go,Dockerfile,README.md,.gitignore}`
- New: `apps/turso-server/internal/server/{config,state,supervisor,proxy,admin,auth,gc}.go`
       and matching `_test.go`
- New: `wiki/ops/turso-server.md` (canonical reference)
- Modified: `charts/values.base.yaml`, `charts/configmap.base.yaml`,
  `charts/questions.base.yaml`, `charts/templates/secret.yaml`,
  `charts/templates/statefulset.yaml`
- Renamed: `charts/templates/turso-primary.yaml` → `turso-server.yaml`
- Renamed: `charts/templates/turso-primary-litestream-config.yaml` →
  `turso-server-litestream-config.yaml`
- Modified: `plugins/plugin-turso/server/{adapter,service,types}.ts`
- Modified: `packages/shared/src/api-keys.ts`

## [2026-05-21] ops | multi-pod K8s smoke test on rancher.home + Dockerfile + sync push fix

Validated the multi-pod deployment end-to-end on a real k3s cluster
(`rancher.home`, single-node arm64 control-plane). Three corrections came
out of the smoke test, each tied to a real bug discovered during execution.

### Dockerfile: bundle mode, not compile

`bun build --compile` cannot embed NAPI native bindings (`.node` files from
`@tursodatabase/database-<platform>-<arch>`) into the bunfs virtual
filesystem, and externalizing them in `--compile` mode resolves from bunfs
at runtime (not the real filesystem). Symptom in the cluster:
`Cannot find native binding. npm has a bug related to optional dependencies`
from the loader inside the compiled binary.

Fix: runtime image now uses `oven/bun:1.3.12-slim` as the runtime stage,
ships the bundled JS (`apps/runtime/dist/index.ts`) plus `node_modules`
(workspace symlinks preserved so the platform-specific binding resolves at
require-time), and runs `bun apps/runtime/dist/index.ts`. The size cost is
acceptable (~310 MB image) and resolution is standard. See `Dockerfile`.

`apps/runtime/scripts/build.ts` now marks `@tursodatabase/database` and
`@tursodatabase/sync` as external in the non-compile path so the bundle
defers their resolution to the runtime `node_modules`.

`apps/runtime/package.json` lists both packages as direct deps so the
workspace install materializes the symlinks under `apps/runtime/node_modules/`
(otherwise the bundled `require('@tursodatabase/database')` cannot find them).

### ApiKeyStore: MVCC pragma vs CDC + explicit sync push

Two corrections to `packages/shared/src/api-keys.ts` after running against
`tursodb --sync-server` v0.6.0:

1. `PRAGMA journal_mode = mvcc` is **not compatible with sync replicas**.
   The sync engine enables CDC on the local replica, and `tursodb` rejects
   the pragma with `cannot enable MVCC while CDC is active`. The MVCC
   pragma now runs only in `mode=local`; the primary controls journal mode
   for sync replicas (defaults to WAL).
2. `@tursodatabase/sync` does **not** push local writes to the primary
   automatically — the periodic timer only `pull()`s. Without an explicit
   `push()` call after each write, the change stays local and other
   replicas never see it. Added a best-effort `pushIfSync()` invoked after
   `create()` and `revoke()`.

### Chart: Turso primary image, sync-server args, http:// scheme

The previous chart used `ghcr.io/tursodatabase/turso:latest` and args
`["db", "--port", "<p>", "--data-dir", "<dir>"]` — both placeholders never
verified. The real product is the official `tursodb` binary from
<https://github.com/tursodatabase/turso/releases> (v0.6.0+), which has a
hidden `--sync-server <addr>` flag and serves a **single** database per
process via plain HTTP (not the `libsql://` scheme).

Concrete chart changes:

- `charts/templates/turso-primary.yaml`: args are now
  `["/var/lib/turso/api-keys.db", "--sync-server", "0.0.0.0:<port>"]`,
  added `imagePullSecrets` block.
- `charts/values.base.yaml`: `tursoPrimary.image.repository =
  "ghcr.io/zommehq/turso"`, `tag = "0.6.0"`.
- `charts/configmap.base.yaml`: `RUNTIME_AUTH_DB_SYNC_URL` now uses
  `http://<release>-turso-primary:<port>` (not `libsql://`). Removed
  bogus `/api-keys` path suffix (the sync-server serves a single DB by
  positional arg, so the URL path is ignored).
- Removed the wishful "auto-config plugin-turso to consume the primary"
  block — `tursodb --sync-server` is single-database, so plugin-turso
  (data plane) cannot share the same primary. Documented as a known
  limitation; multi-database support waits on a future Turso release.

### Turso server image

Built `ghcr.io/zommehq/turso:0.6.0` from the official arm64
binary (`turso_cli-aarch64-unknown-linux-gnu.tar.xz` from the v0.6.0
release) wrapped in `debian:bookworm-slim`. The bundled `tursodb` binary
exposes `--mcp` and `--sync-server` modes via undocumented flags surfaced
in `tursodb --help`.

### Cluster fitness

The rancher.home cluster (single-node k3s on multipass arm64 VMs) only had
`local-path` storage class (RWO). Chart defaults set `RWX` for plugins/
apps PVCs — the smoke test ran with `--set persistence.{plugins,apps}.\
accessMode=ReadWriteOnce` (safe on single-node since multiple pods can
share an RWO PVC when scheduled on the same node). For multi-node, a real
RWX provisioner (NFS, Longhorn, Ceph) is required.

DNS resolution for `*.home` on the multipass VMs was missing — the host
`/etc/resolv.conf` pointed to `8.8.8.8`. Fix: dropped
`/etc/systemd/resolved.conf.d/buntime-dnsmasq.conf` on each VM via
`multipass exec ... systemctl restart systemd-resolved`, pointing to the
Mac's dnsmasq (192.168.0.5). This is environment-specific and not part
of the chart.

### End-to-end validation

3-pod `StatefulSet` with `tursoPrimary.enabled=true`, `authDb.mode=sync`:

1. `kubectl exec buntime-2 -- POST /_/api/keys` → 201, new key created.
2. Wait 70 s (the configured `syncIntervalSeconds`).
3. `kubectl exec buntime-{0,1,2} -- GET /_/api/keys` → all three pods
   return 7 keys including the newly-created one.

Primary's `/var/lib/turso/api-keys.db` ends up with one row per key,
verified by snapshotting and reading the file with a separate `tursodb`
instance. Writes from any pod converge on every pod within one sync
interval.

### Files changed

- `Dockerfile` (compile → bundle, bun runtime stage)
- `apps/runtime/package.json` (`@tursodatabase/{database,sync}` as direct deps)
- `apps/runtime/scripts/build.ts` (external Turso in non-compile path)
- `packages/shared/package.json` (add `linux-arm64-gnu` optional bindings)
- `packages/shared/src/api-keys.ts` (MVCC only in local, `pushIfSync()` in sync)
- `charts/values.base.yaml` (Turso primary image)
- `charts/templates/turso-primary.yaml` (real args + `imagePullSecrets`)
- `charts/configmap.base.yaml` (`http://` scheme, no path)
- `charts/{values,questions}.yml` (regenerated)

### Verification

```sh
bun test           # 2715 / 2715 passing
bun run lint       # all workspaces clean
```

Local smoke (single-pod, `mode=local`): create + list keys round-trips on
the compiled binary (Docker). Cluster smoke (3-pod, `mode=sync`,
`tursoPrimary.enabled=true`): write on any pod, read on all pods after
`syncIntervalSeconds`.

## [2026-05-20] runtime + ops | multi-pod via self-hosted Turso server + ApiKeyStore on Turso DB

Multi-pod support for the runtime, with all state durable on a self-hosted
Turso server primary (no Cloud Turso dependency).

### ApiKeyStore: bun:sqlite → Turso DB embedded

`packages/shared/src/api-keys.ts` migrated from `bun:sqlite` to
`@tursodatabase/database` (local mode) + `@tursodatabase/sync` (embedded
replica mode). The on-disk format is binarily SQLite-compatible — existing
`api-keys.db` files open transparently; the `PRAGMA journal_mode` switches
to `mvcc` on first write.

New modes:

- **`local`** (default, single-pod) — standalone Turso DB file at
  `<stateDir>/api-keys.db`. Same behavior as before, just a different driver.
- **`sync`** (multi-pod) — embedded replica that pulls from / pushes to a
  remote Turso server primary at `RUNTIME_AUTH_DB_SYNC_URL`. Reads stay local
  (O(log n) + in-memory cache); writes are serialized at the primary via MVCC.

Public API of `ApiKeyStore` is mostly preserved but now async at construction:
`ApiKeyStore.open(cfg)` / `ApiKeyStore.fromStateDir(stateDir, cfg?)`. Direct
`new ApiKeyStore(path)` is no longer allowed (constructor is private). New
config type `AuthDbConfig { mode, dbPath, syncUrl?, syncAuthToken?,
syncIntervalSeconds? }`. New env vars `RUNTIME_AUTH_DB_MODE`,
`RUNTIME_AUTH_DB_SYNC_URL`, `RUNTIME_AUTH_DB_SYNC_TOKEN`,
`RUNTIME_AUTH_DB_SYNC_INTERVAL_SECONDS` (forwarded to workers too).

Bootstrap independence preserved: `local` mode is self-contained, opens
before any plugin loads. `sync` mode requires the primary URL but no plugin.

### Helm chart: Deployment → StatefulSet + Turso primary + Litestream

- `charts/templates/deployment.yaml` → `statefulset.yaml`. Migration path:
  `helm uninstall && helm install` (no in-place upgrade for Deployment →
  StatefulSet). Preserve PVCs `plugins` and `apps` via `--keep-pvc` or
  backup/restore. The `state` volume is per-pod (`volumeClaimTemplates`,
  RWO 500Mi default), so it's recreated empty per pod and synced from the
  primary when `mode=sync`.
- Headless Service `<release>-headless` added (stable per-pod DNS).
- New optional template `charts/templates/turso-primary.yaml` —
  single-replica StatefulSet running the Turso server. Hosts every database
  consumed by the runtime fleet (`api-keys`, `runtime`, per-plugin/per-app).
  Gated by `tursoPrimary.enabled` (default false).
- Optional Litestream sidecar + `initContainer` for continuous backup /
  restore against an S3-compatible store (MinIO). Gated by
  `tursoPrimary.litestream.enabled`. ConfigMap
  `turso-primary-litestream-config.yaml` enumerates the databases to
  replicate.
- New values: `buntime.authDb.{mode, syncUrl, syncAuthToken,
  syncIntervalSeconds}`, `persistence.state.{size, storageClass}`,
  `tursoPrimary.{enabled, image, service, resources, persistence, authToken,
  litestream.{enabled, image, s3.{...}, databases}}`. All exposed via
  Rancher questions.
- Configmap auto-populates `RUNTIME_AUTH_DB_SYNC_URL` to point at the
  in-cluster primary when `tursoPrimary.enabled=true`. Operator still needs
  to set `plugins.turso.mode=sync` + `plugins.turso.sync.url` explicitly to
  point the data plane (`plugin-turso`) at the same primary (in databases
  by namespace).

### plugin-deployments

`buildMiddleware()` in the worker is now async and accepts the new
`RUNTIME_AUTH_DB_*` envs. Added `@tursodatabase/database`/`sync` as deps so
the worker bundle resolves native bindings at runtime; bundler marks them
as external in `scripts/build.ts`.

### Why `plugin-turso` remains

`plugin-turso` is the canonical SQL abstraction of the **data plane** —
other plugins (gateway, proxy, keyval, …) consume `TursoService` via DI for
their own state. It centralizes connection lifecycle, multi-database
namespace selection, and health observability. The `ApiKeyStore` can't use
it (bootstraps before any plugin loads), but they can share the same Turso
server primary in **separate databases**, scoped by namespace, with no
interference.

### Documentation

- New `wiki/ops/multi-pod-deployment.md` — full self-hosted guide
  (architecture, Helm command, adding databases, DR).
- `wiki/data/storage-overview.md` — store description updated for two modes
  (local/sync), Helm path moved to `/data/state/api-keys.db`.
- `wiki/ops/helm-charts.md` — StatefulSet documented, templates list
  updated.
- `wiki/apps/runtime-api-reference.md` — store description + backend
  evolution timeline.

### Validation

- `bun run lint`: 13 workspaces clean.
- `bun test`: 2715/2715 pass (one new case: fail-fast when `mode=sync`
  without `syncUrl`).
- Live local smoke (mode=local): `api-keys.db` opens binarily,
  `PRAGMA journal_mode=mvcc` after first write, CRUD via `/api/keys` works,
  plugin-deployments admin endpoints gated correctly.
- `helm template` renders both single-pod (local) and multi-pod (sync +
  primary + litestream) configurations cleanly.

## [2026-05-20] runtime | ApiKeyStore migrated to bun:sqlite + MASTER_KEY → ROOT_KEY

Two coordinated changes to the runtime API-key authentication, both
breaking for any external consumer of the env var / API names:

### 1. Storage backend: JSON → SQLite

`ApiKeyStore` (in `packages/shared/src/api-keys.ts`) now persists to a
local SQLite database via Bun's builtin `bun:sqlite` driver instead of a
JSON file. Public interface (`list`, `verify`, `create`, `revoke`,
`hasKeys`, `fromStateDir`) is unchanged, so every consumer keeps working.

**Why:** the JSON store loaded the entire file into memory and did O(n)
linear `keys.find(...)` on every `verify()` — the hot path of every
authenticated API request. With SQLite:

- Lookup is O(log n) via the partial index
  `idx_api_keys_lookup ON api_keys(key_hash) WHERE revoked_at IS NULL`.
- WAL mode handles concurrent reads/writes safely across the runtime
  process and any plugin worker reading the same DB.
- ACID transactions replace the JSON's "rewrite the whole file on every
  `touchLastUsed`" pattern. The 60 s coalesce window stays in place.
- Migrations become natural (`PRAGMA user_version` + `ALTER TABLE`).
- Bootstrap independence is preserved: SQLite is builtin to Bun, no
  plugin dependency, works on day zero.

**Storage layout:** `${stateDir}/api-keys.db` (was `.json`). On first boot
the store auto-detects a sibling legacy `api-keys.json`, migrates every
row across in a single transaction, and renames the JSON to
`api-keys.json.migrated` (defensive backup — never deleted automatically).

Files touched: `packages/shared/src/api-keys.ts` (entire body rewritten),
test files in `apps/runtime/src/{libs,routes}/` and
`packages/shared/src/middleware/` (use `.db` extension in store paths).
`apps/runtime/src/libs/api-keys.ts` is unchanged — still a re-export
shim from `@buntime/shared/api-keys`.

### 2. `RUNTIME_MASTER_KEY` → `RUNTIME_ROOT_KEY`

The runtime's high-privilege bootstrap key (and the synthetic principal
it produces when authenticated) was renamed from `master` to `root`. The
old name leaked deployment-pipeline vocabulary into the auth layer
(`MASTER_KEY` reads as "deploy/CD key"); `root` matches the Unix-shell
mental model and the actual semantics (full access, bypasses every
check).

Renames applied throughout:

- Env vars: `RUNTIME_MASTER_KEY` / `BUNTIME_MASTER_KEY` →
  `RUNTIME_ROOT_KEY` / `BUNTIME_ROOT_KEY`.
- Code: `PluginAuthContext.masterKey` → `rootKey`;
  `ApiKeyMiddlewareOptions.masterKey` → `rootKey`;
  `ApiKeyPrincipal.isMaster` → `isRoot`; `createAdminRoutes({ masterKey })`
  → `createAdminRoutes({ rootKey })`; `new PluginLoader({ masterKey })` →
  `new PluginLoader({ rootKey })`.
- Synthetic principal: `{ name: "master", keyPrefix: "master" }` →
  `{ name: "root", keyPrefix: "root", isRoot: true }`.
- Helm: `buntime.masterKey` (values.yaml/questions) → `buntime.rootKey`;
  Secret key `RUNTIME_MASTER_KEY` → `RUNTIME_ROOT_KEY`.
- Worker env forwarding (`apps/runtime/src/libs/pool/instance.ts`):
  `RUNTIME_MASTER_KEY` env passed to workers → `RUNTIME_ROOT_KEY`.
- Cpanel UI: `principal.isMaster` checks → `isRoot`; i18n keys
  `admin.overview.masterKey`/`masterDescription` →
  `rootKey`/`rootDescription`.
- All wiki pages mentioning master key/MASTER_KEY: cpanel.md,
  runtime-api-reference.md, runtime.md, plugin-deployments.md,
  plugin-auth-boundary.md, data/storage-overview.md, ops/security.md,
  index.md.

### Validation

- `bun run lint` (monorepo): all 13 workspaces clean.
- `bun test` (root): 2714/2714 pass, 0 fail.
- Live smoke against running runtime: SQLite file
  `plugins/.buntime/api-keys.db` created on first boot, legacy
  `api-keys.json` renamed to `.migrated`, `RUNTIME_ROOT_KEY` authenticates
  as principal `{ name: "root", isRoot: true, role: "admin" }`, CRUD via
  the new store works (create / verify / list / revoke), `sqlite3
  api-keys.db .schema` shows the expected table + partial indices.

### External consumers

Anyone integrating against the runtime via raw HTTP or env vars must
update:

- Replace `RUNTIME_MASTER_KEY` with `RUNTIME_ROOT_KEY` in env / Helm
  values / Kubernetes Secrets.
- If reading the runtime principal JSON, expect `isRoot: true` and
  `name: "root"` instead of `isMaster: true` / `name: "master"`.
- If shipping a SQLite-aware backup pipeline (e.g. a CronJob copying the
  state dir), point it at `api-keys.db` instead of `api-keys.json`.

## [2026-05-20] repo | remove apps/cli (Go) and apps/vault

The Go CLI (`apps/cli/`) was removed from the monorepo. The cpanel (with the
runtime sections under `/cpanel/{overview,keys,workers,plugins}`) now covers
every operator workflow that the CLI/TUI used to cover, and there is no plan
to ship a separate Go client. `apps/vault/` had already been removed earlier
in the day by the user — completing the cleanup of its wiki traces here.

Repo changes:

- Deleted `apps/cli/` entirely (Go module, TUI screens, internal/api,
  internal/db with the SQLite-backed profiles, docs/tui-design.adoc).
- Deleted `.github/workflows/cli-build.yml` (CGO matrix for linux/windows/macOS).
- Trimmed `.gitlab-ci.yml`: removed `cli` stage and the three `cli:build:*`
  jobs (linux/windows/macos) plus the `CLI_ARTIFACT_EXPIRE_IN` variable.
  `image:build` (Docker) stays.
- `.gitignore` lost the dead `packages/cli-go/buntime-cli` line and gained
  `**/.buntime/` so the runtime state dir (`api-keys.json`, `.dirinfo`)
  cannot be committed by accident on dev machines.

Wiki changes:

- Deleted `wiki/apps/cli.md` and `wiki/apps/vault.md` (the pages are gone;
  their entries in `wiki/sources/initial-ingest.md` are historical and stay
  as-is).
- `wiki/index.md`: removed the CLI and Vault rows from the "Client apps"
  table — only CPanel remains.
- `wiki/apps/cpanel.md`: dropped the CLI cross-reference and rewrote the
  package-validation paragraph to point at the upload endpoints directly
  (no more "same semantics as the CLI" pointer).
- `wiki/apps/plugin-deployments.md`: dropped the "Go CLI" integration bullet.
- `wiki/ops/release-flow.md`: dropped the `cli-build.yml` workflow row and
  the entire "CLI artifacts" subsection (build matrix, version injection,
  CGO toolchains).

Why now: the unified cpanel sidebar (Workers / Keys / Plugins as first-class
routes, plus every plugin UI in the same layout) replaced the CLI's reason
to exist. Keeping a second client surface required parallel maintenance
(Go permission constants, separate publishing pipeline, separate docs) for
no incremental capability.

## [2026-05-19] runtime + cpanel + cli | apps → workers (single vocabulary)

The runtime had two vocabularies for the same concept: `apps:*` (filesystem
ops on deployed artifacts, with endpoints `/api/apps`) and `workers:*` (a
ghost set of permissions for `/api/workers/*` endpoints that were never
implemented). Apps and workers are the same in Buntime — every app is served
by a worker in the WorkerPool — and the rest of the runtime (`workerDirs`,
`WorkerPool`, `getWorkerStats()`) already spoke worker. The "apps" surface
existed only at the public API boundary, dragging the duplicated UI you saw
in the cpanel Overview ("Deployments" + "Workers" rows for the same thing).

The two vocabularies collapsed into **workers**:

- Permissions: `apps:read|install|remove` removed. `workers:read`,
  `workers:install`, `workers:remove`, `workers:restart` are the canonical
  set. `restart` is reserved for a future endpoint (no implementation yet,
  but the permission is wired so a key can carry it).
- API: `/api/apps/*` → `/api/workers/*` (same shapes, same behaviors). Error
  codes renamed: `APP_NOT_FOUND` → `WORKER_NOT_FOUND`,
  `BUILT_IN_APP_REMOVE_FORBIDDEN` → `BUILT_IN_WORKER_REMOVE_FORBIDDEN`, etc.
- Cpanel: `/cpanel/apps` route renamed to `/cpanel/workers`; sidebar item
  "Apps" → "Workers"; Overview duplicated "Workers" row removed (the
  capabilities grid now lists Workers / Plugins / Keys, in that order).
- CLI: `PermApps*` constants in Go → `PermWorkers*` (one new constant
  `PermWorkersInstall` replaces the old `PermAppsInstall`).
- Internal code: `routes/apps.ts` → `routes/workers.ts`; `createAppsRoutes`
  → `createWorkersRoutes`; `AppInfoSchema` (openapi) → `WorkerInfoSchema`;
  cpanel helpers `listApps/uploadApp/deleteApp/deleteAppVersion` →
  `listWorkers/uploadWorker/deleteWorker/deleteWorkerVersion`.
- Dev keys at `plugins/.buntime/api-keys.json` migrated in place
  (`apps:read` → `workers:read`, etc.).

Wiki: `apps/cpanel.md`, `apps/runtime-api-reference.md`, `apps/runtime.md`,
`apps/cli.md`, `apps/plugin-authn.md`, `index.md` updated. The runtime API
reference now starts its workers section with a short note explaining the
collapse, so anyone arriving with the old vocabulary in mind has a pointer.

Lint+test at root: 2714/2714 pass, no regressions. Live smoke against the
running runtime confirms `/api/workers` (master 200, no key 401, viewer 200
ro) and `/api/apps` returns 404.

This entry is intentionally explicit because the change touched the public
API surface: anyone consuming the runtime via raw HTTP needs to update their
client. The cpanel and CLI were updated in the same commit; downstream Helm
charts and external consumers (if any) need the same renames.

## [2026-05-19] apps | cpanel — `/admin` subpath removed (everything is cpanel)

The cpanel SPA dropped the `/admin/*` subpath. Runtime sections that lived
under `/cpanel/admin/{overview,keys,apps,plugins}` are now first-class routes
directly under `/cpanel/`:

- `/cpanel/overview` (default landing — `/cpanel/` redirects here)
- `/cpanel/keys`
- `/cpanel/apps`
- `/cpanel/plugins`

Sidebar grouping was renamed `Admin` → `Runtime` (`nav.runtime`) and moved to
the top of the sidebar, with the Platform group (installed plugin menus)
listed below it.

Rationale: the previous structure suggested two areas (plugin shell vs admin
console). The cpanel has only one area — itself. Removing the `/admin`
segment makes the URLs match the concept and removes one level of nesting
from breadcrumbs and route files. The internal `components/admin/` directory
and `admin-api.ts` helper kept their names (implementation detail), but the
URL surface is flat.

Repo changes:

- `apps/cpanel/src/routes/admin/` folder and `routes/admin.tsx` layout
  deleted; new `routes/{overview,keys,apps,plugins}.tsx` created.
- `routes/index.tsx` now redirects `/` → `/overview` (was `/$?_splat=deployments`).
- `routes/__root.tsx` sidebar URLs updated; group label changed to "Runtime";
  group order swapped (Runtime first, Platform second).
- i18n: removed `nav.admin` and the `admin.tabs.*` namespace; added
  `nav.runtime`, `nav.overview`, `nav.keys`, `nav.apps`, `nav.plugins`.
- Wiki updates: `apps/cpanel.md` (Overview, Folder structure, Authentication,
  Features, Bootstrap day-zero flow, Access in Rancher environments, Micro-
  frontend), `apps/runtime-api-reference.md` ("CPanel Admin — Notes" renamed
  to "CPanel — Notes"), `apps/cli.md`, `agents/testing-patterns.md`, and
  `index.md` no longer reference `/cpanel/admin`.
- Build regenerates `routeTree.gen.ts` cleanly; `bun run lint && bun test` at
  root: 2714/2714 tests pass, no regressions.

Note on the [Plugin auth boundary](apps/plugin-auth-boundary.md): plugins
still use `/<plugin-base>/admin/**` for their control-plane endpoints — that
convention is unaffected. The change applies only to **cpanel's own URLs**,
which no longer have an `/admin` segment.

## [2026-05-19] apps + plugins | control-plane / data-plane boundary

Separated each core plugin's HTTP surface into two zones with explicit
authentication contracts:

- **Control plane** (`/<base>/admin/**`): operator gestão, gated by the runtime
  `X-API-Key` store via a new shared middleware
  ([`@buntime/shared/middleware/api-key`](apps/plugin-auth-boundary.md)).
- **Data plane** (`/<base>/**` outside `/admin/`): end-user/M2M behaviour, still
  governed by `plugin-authn` or the plugin's own gate.

What changed:

- New canonical page [`apps/plugin-auth-boundary.md`](apps/plugin-auth-boundary.md)
  documenting the convention, the shared middleware (extractApiKey, role gate,
  principal injection), the persistent-plugin and serverless-plugin patterns,
  the client-side helpers (`apiKeyFetch`, `apiKeyHeaders`, `readCpanelApiKey`),
  and per-plugin status table.
- `apps/cpanel.md` notes that the same API key opens admin UIs of every core
  plugin (Deployments, Proxy, Authz, Gateway, Logs, Metrics, Authn SCIM).
- `apps/plugin-authn.md` notes the core-plugin control-plane exclusion —
  `plugin-authn` no longer mediates operator gestão; it returns to its original
  role (end-user sessions + M2M apiKeys[]). SCIM endpoints moved to
  `/auth/admin/scim/v2/**` and sit behind the shared X-API-Key gate.

Out of scope (deprecated):

- `plugin-database` and `plugin-keyval` are being retired; `plugin-turso` is the
  replacement. They are intentionally NOT migrated. When `plugin-turso` gains
  HTTP endpoints, they must follow this convention from day one.

Why: the cpanel was already on X-API-Key end-to-end (previous entry below), but
plugin UIs hosted in its iframes still required separate `plugin-authn`
sessions. Operators were juggling two identities. This boundary collapses that
to a single login: one API key created in the cpanel opens every core plugin's
admin UI through the unified sidebar.

Repo changes that prompted this entry:

- `packages/shared/src/api-keys.ts` moved from `apps/runtime/src/libs/api-keys.ts`
  (runtime keeps a re-export shim for backwards-compat).
- `packages/shared/src/middleware/api-key.ts` — new shared middleware with full
  test coverage (12 cases).
- `packages/shared/src/client/api-key.ts` — browser-side helpers
  (`apiKeyFetch`, `apiKeyHeaders`, `readCpanelApiKey`).
- `packages/shared/src/types/plugin.ts` — `PluginContext.auth` field
  (`{ store?, masterKey? }`) forwarded by the loader.
- `apps/runtime/src/plugins/loader.ts` and `apps/runtime/src/api.ts` — propagate
  `apiKeys` and master key to each plugin via `PluginContext.auth`.
- `apps/runtime/src/libs/pool/instance.ts` — forwards `RUNTIME_STATE_DIR` and
  `RUNTIME_MASTER_KEY` to workers so serverless plugins can authenticate too.
- Six plugin migrations: `plugin-proxy`, `plugin-authz`, `plugin-deployments`,
  `plugin-gateway`, `plugin-authn` (SCIM only), `plugin-logs`, `plugin-metrics`.
  Each: manifest `publicRoutes` declared, basePath shifted, middleware wired,
  clients use `apiKeyFetch` / `?_key=` SSE fallback, tests updated.
- All 2714 tests pass (`bun test` at root).
- `apps/packages.md` updated to list the three new `@buntime/shared` subpaths
  (`./api-keys`, `./client/api-key`, `./middleware/api-key`) and bumped the
  version row to `1.2.0` (additive, backwards-compatible).

## [2026-05-19] apps | cpanel unified under API-key auth (bootstrap independence)

The cpanel and its `/admin` sub-area now share a single authentication model
and a single unified navigation. Both areas authenticate end-to-end against
the core runtime via `X-API-Key`; the entire cpanel was removed from the
`plugin-authn` gate so it remains usable on day zero, before any plugin is
installed or configured.

What changed:

- `apps/cpanel.md` rewrote the Manifest, Authentication, Micro-frontend and
  Security sections to reflect the cpanel-wide gate; replaced the old
  "Integration with plugin-authn" section with a new "Bootstrap independence"
  section that walks the day-zero flow (master key → admin key → install
  plugin-authn → protect everything else). Folder structure updated to match
  the new layout (`components/auth/`, `components/admin/tabs/`, file-based
  routes under `routes/admin/`).
- `apps/plugin-authn.md` notes the cpanel exclusion: `publicRoutes: { GET:
  ["/**"] }` in the cpanel manifest keeps plugin-authn out of the cpanel's
  way; everything else continues to be protected.

Why: the cpanel is the bootstrap entrypoint of the runtime — it is where
plugins (including plugin-authn) are installed and configured. Making the
cpanel depend on plugin-authn was a chicken-and-egg problem. Unifying both
zones under X-API-Key also eliminates the dual-layout duality between
`/cpanel/` (plugin shell, behind plugin-authn) and `/cpanel/admin` (already
behind X-API-Key), producing a single sidebar that lists plugin menus and
admin tabs side-by-side, permission-filtered.

Repo changes that prompted this entry:

- `apps/cpanel/manifest.yaml` — publicRoutes expanded to `GET: ["/**"]`.
- `apps/cpanel/src/contexts/admin-auth-context.tsx` renamed to
  `api-key-auth-context.tsx`; `useAdminAuth` → `useApiKey` etc.
- `apps/cpanel/src/components/admin/admin-console.tsx` (1720 lines) split
  into `shared.tsx` + `tabs/{overview,keys,apps,plugins}.tsx`.
- New `apps/cpanel/src/components/auth/{api-key-login,loading-splash}.tsx`.
- File-based admin sub-routes: `apps/cpanel/src/routes/admin.tsx` (layout),
  `routes/admin/index.tsx` (redirect to overview), and one file per tab.
- `apps/cpanel/src/routes/__root.tsx` rewritten with a global auth gate and
  a unified MainLayout/sidebar for both shell and admin.
- `MainLayout` gained `sidebarFooterAction` for the new logout button.
- i18n: removed dead `admin.shell.*`, `admin.header.*`, `nav.adminMode`.

## [2026-05-02] agents | proxy runtime validation gotchas

Recorded runtime validation findings from loading `@buntime/plugin-proxy` through
the real plugin loader and browser UI.

What changed:

- `apps/plugin-turso.md`, `agents/turso-implementation-handoff.md`, and
  `agents/turso-clean-session-plan.md` now document the Turso native binding
  failure mode and the need to rebuild `dist/plugin.js` bundles before runtime
  validation.
- Captured that `@tursodatabase/database` and `@tursodatabase/sync` are native
  dependency packages per the official Turso TypeScript reference.
- Captured the Darwin ARM64 local binding names that resolved the loader error:
  `@tursodatabase/database-darwin-arm64` and
  `@tursodatabase/sync-darwin-arm64`.

Why: source-level tests can pass while runtime validation fails if Bun skipped a
native optional dependency or if the runtime is still loading stale bundled
plugin code through `manifest.pluginEntry`.

## [2026-05-02] ops | runtime chart migrated to Turso settings

Migrated runtime Helm generation from legacy LibSQL/database adapter settings to
the Turso provider settings generated from `plugins/plugin-turso/manifest.yaml`.

What changed:

- `ops/helm-charts.md`, `apps/plugin-turso.md`, and `data/storage-overview.md`
  now describe `plugins.turso.*` values and generated `TURSO_*` env vars as the
  runtime chart surface.
- `agents/turso-implementation-handoff.md` and
  `agents/turso-clean-session-plan.md` now mark chart/runtime configuration as
  completed and point the next slice at remaining legacy database-adapter
  consumers/docs.
- Recorded that `@buntime/plugin-turso` is enabled by default and
  `@buntime/plugin-database` is disabled by default for manifest-driven runtime
  loading and Helm generation.
- Recorded that the runtime chart mounts `/data/turso` as `emptyDir`, making the
  Turso local file pod-local and suitable as a sync cache rather than a shared
  Kubernetes database file.

Why: KeyVal, Gateway, and Proxy now depend on Turso directly, so the runtime
chart must load the Turso provider and stop exposing `plugins.database.libsql*` /
`DATABASE_LIBSQL_*` as the active storage configuration surface.

## [2026-05-02] agents | plugin-proxy migrated to Turso

Migrated `@buntime/plugin-proxy` dynamic-rule persistence from KeyVal-backed
state to direct `@buntime/plugin-turso` storage.

What changed:

- `apps/plugin-proxy.md`, `data/storage-overview.md`, `data/keyval-tables.md`,
  `apps/plugin-keyval.md`, and `index.md` now describe proxy's current
  `proxy_rules` table and no longer present KeyVal as proxy infrastructure.
- `agents/turso-implementation-handoff.md` and
  `agents/turso-clean-session-plan.md` now point the next slice at chart/runtime
  Turso configuration instead of proxy storage migration.
- Recorded that static proxy rules still work without Turso, while dynamic rule
  mutations return `400 Dynamic rules not enabled` when Turso is unavailable.

Why: Proxy now follows the chosen `proxy -> turso` dependency graph and remains
independent from KeyVal/Database for its own operational state.

## [2026-05-02] agents | plugin-gateway migrated to Turso

Migrated `@buntime/plugin-gateway` persistence from KeyVal-backed state to
direct `@buntime/plugin-turso` storage.

What changed:

- `apps/plugin-gateway.md` and `data/storage-overview.md` now describe gateway's
  current `gateway_metrics_history` and `gateway_shell_excludes` tables.
- `agents/turso-implementation-handoff.md` and
  `agents/turso-clean-session-plan.md` now point the next consumer slice at
  `@buntime/plugin-proxy`.
- Recorded the visible API label change for dynamic shell excludes from
  `source: "keyval"` to `source: "turso"`.

Why: Gateway is now independently enableable without KeyVal/Database for its own
durable state, preserving the chosen `gateway -> turso` dependency graph.

## [2026-05-02] agents | plugin-keyval migrated to Turso

Migrated `@buntime/plugin-keyval` from `@buntime/plugin-database` to
`@buntime/plugin-turso` and updated the wiki references for the completed
consumer slice.

What changed:

- `apps/plugin-keyval.md`, `data/storage-overview.md`, and
  `data/keyval-tables.md` now describe KeyVal's current Turso-backed storage.
- `apps/plugin-turso.md`, `agents/turso-implementation-handoff.md`, and
  `agents/turso-clean-session-plan.md` now point the next slice at gateway or
  proxy instead of KeyVal.
- Recorded Turso SDK gotchas found during migration: DDL needs an exclusive
  transaction, MVCC rejects virtual tables, KeyVal search uses regular
  `kv_fts_*` tables, and BLOB key ordering uses `hex(key)` for stable reverse
  pagination.

Why: KeyVal is the first real consumer of the Turso provider, and future
sessions need the updated dependency graph plus the SDK compatibility notes.

## [2026-05-02] agents | Turso clean-session plan

Added [`agents/turso-clean-session-plan.md`](./agents/turso-clean-session-plan.md)
to summarize what the Turso migration has already completed, what the next clean
session should do, and what dependency graph guardrails must be preserved.

Also updated the Turso handoff and plugin page to record the real
`PluginLoader` smoke test that verifies the hook-only service plugin is loaded
and registered through manifest discovery.

Why: the next session needs a concise orientation document that explains both
the completed implementation slice and the next consumer migration slice without
carrying the previous conversation transcript.

## [2026-05-02] agents | plugin-turso service slice completed

Implemented the documented `@buntime/plugin-turso` service slice and updated
the wiki handoff to make the next clean-session step explicit.

What changed:

- Added the initial service contract, adapter, service implementation, plugin
  entrypoint, and colocated tests under `plugins/plugin-turso/`.
- Documented the current implementation state in
  [`apps/plugin-turso.md`](./apps/plugin-turso.md).
- Updated [`agents/turso-implementation-handoff.md`](./agents/turso-implementation-handoff.md)
  so future sessions start from the next consumer migration slice.
- Recorded a plugin-system gotcha: hook-only infrastructure plugins should omit
  `base` entirely instead of setting `base: ""`.

Why: the Turso provider now has a tested runtime service surface, and the
handoff should not continue to point agents at already-completed files.

## [2026-05-02] agents | Turso implementation handoff for clean sessions

Added `wiki/agents/turso-implementation-handoff.md` to capture the current
Turso migration decision, partial implementation state, next coding slice, SDK
notes, validation commands, and context-budget guidance for resuming in a clean
Codex session.

Why: the active Codex thread has a high compacted context cost from historical
UI/admin/runtime work plus tool, skill, memory, and AGENTS instructions. The
handoff lets a new session resume from a concise wiki entry instead of carrying
the full transcript.

## [2026-05-02] architecture | plugin-turso provider for gateway, proxy, and keyval

Recorded the refined Turso storage dependency graph:

- `@buntime/plugin-turso` is the planned core durable SQL provider.
- `@buntime/plugin-database` remains a legacy/historical multi-adapter surface,
  not the Turso implementation target.
- `@buntime/plugin-keyval` should migrate from `plugin-database` to
  `plugin-turso`.
- `@buntime/plugin-gateway` and `@buntime/plugin-proxy` should depend directly
  on `plugin-turso` for their own `gateway_*` and `proxy_*` schemas.
- The alternative `gateway/proxy -> keyval -> turso` was rejected as the
  production graph because it would make KeyVal mandatory gateway/proxy
  infrastructure. KeyVal should instead be validated through its own tests and
  integration smoke flows.

Why: gateway/proxy must remain independently enableable in Kubernetes and
single-purpose deployments, while `plugin-turso` centralizes connection, sync,
MVCC, and retry behavior for durable SQL.

## [2026-05-02] ops | Security vulnerability backlog migrated to wiki

Migrated the historical runtime vulnerability and availability audit from
`apps/runtime/roadmap/vulnerabilities.md` to
`wiki/ops/security-vulnerability-backlog.md`, with a source summary at
`wiki/sources/2026-05-02-security-vulnerability-backlog.md`.

Also updated `.wiki-guardrails.yml` so the drift audit explicitly allows the
canonical `wiki/**/*.md` files and minimal `plugins/*/README.md` package
entrypoints.

Why: `apps/runtime/plans/*.md` are being removed as legacy planning drift, while
the vulnerability audit remains operationally relevant and belongs in the
canonical wiki.

## [2026-05-02] ops | Workload kind for runtime, Turso, apps, and plugins

Clarified Kubernetes workload boundaries:

- The Turso service chart should replace legacy LibSQL as a StatefulSet because
  it owns the durable database endpoint.
- The Buntime runtime should remain a Deployment by default because it is
  compute, not the canonical database owner.
- Runtime Turso sync files are pod-local cache/state and can be ephemeral or
  per-pod PVC depending on whether unsynced writes must survive pod loss.
- `/data/apps` and `/data/plugins` should remain shared artifact volumes, not
  per-pod StatefulSet volumes, because replicas must see the same uploaded code.

Why: StatefulSet is appropriate for durable identity-bound storage, but apps and
plugins are shared deployment artifacts and runtime pods should remain scalable
unless pod-local sync durability becomes a hard requirement.

## [2026-05-02] ops | Turso service replaces legacy LibSQL chart

Clarified the Kubernetes deployment target for Turso:

- In self-hosted Kubernetes, both `sync` and `remote` modes require a Turso
  endpoint service.
- That endpoint can be external Turso Cloud or an in-cluster Turso service.
- For the local/Rancher chart family, the in-cluster Turso service should
  replace the legacy LibSQL StatefulSet chart instead of extending it.
- Runtime pods must not share one embedded database file through a RWX volume.

Why: `sync` needs a remote sync endpoint and `remote` needs a SQL-over-HTTP
endpoint. Both are service concerns distinct from the runtime pod.

## [2026-05-02] architecture | Turso Sync as Kubernetes storage mode

Refined the Turso-only storage target:

- Removed `memory` from the target storage contract for gateway/proxy.
- Local Turso files are only for local tests and single-pod deployments.
- Kubernetes deployments should use Turso Sync, with each pod owning its local
  database file and synchronizing through a remote sync server.
- `remote`/serverless Turso access remains an optional mode for deployments
  that want to avoid local files, not the baseline Kubernetes target.

Why: Turso concurrent writes solve engine-level writer concurrency, but sharing
one embedded database file across multiple Kubernetes pods still depends on
storage-backend filesystem and locking semantics.

## [2026-05-02] architecture | Turso-only durable SQL target

Clarified the storage roadmap:

- Buntime's durable SQL target is **Turso Database only**.
- Existing LibSQL/SQLite/Postgres/MySQL references document current/legacy code,
  not a long-term adapter matrix.
- `plugin-database`, `@buntime/database`, `plugin-keyval`, `plugin-authn`, the
  plugin index, and storage pages now mark adapter-specific surfaces as
  migration candidates.
- Future external database integrations can be reconsidered later, but they are
  not part of the runtime's baseline durable SQL driver.

Why: the runtime should keep the operational surface small and use Turso's
concurrent write model instead of maintaining multiple SQL drivers.

## [2026-05-02] architecture | Plugin-owned Turso storage for gateway/proxy

Recorded the storage decision for `@buntime/plugin-gateway` and
`@buntime/plugin-proxy`:

- Gateway/proxy must not depend on `@buntime/plugin-keyval` or
  `@buntime/plugin-database` just to persist their own operational state.
- Each plugin should own its persistence contract and provide at least an
  ephemeral `memory` driver plus a durable Turso Database driver.
- Turso Database is preferred over `bun:sqlite` for durable gateway/proxy state
  because Turso supports MVCC and `BEGIN CONCURRENT`, while SQLite WAL still
  allows only one writer at a time.
- The wiki now distinguishes current implementation (`plugin-keyval` backing)
  from the target architecture (plugin-owned storage).
- `plugin-keyval` now documents gateway/proxy as current consumers only, not
  long-term typical consumers.

Why: operators need to enable gateway/proxy independently in environments where
KeyVal/Database plugins are disabled, without giving up durable state in
production.

## [2026-05-02] tooling | Wiki enforcement hooks adapted from `zomme`

Adapted the wiki enforcement hook set from the sibling `zomme` monorepo to the
Buntime repository model:

- Codex now runs markdown policy checks, sensitive-path wiki consideration, and
  wiki reindexing on `PostToolUse`, plus a `SessionStart` markdown drift audit.
- Claude Code now runs markdown policy checks and wiki reindexing on
  `PostToolUse`, a `SessionStart` drift audit, and a `Stop` reminder when
  sensitive source paths changed.
- Markdown policy is Buntime-specific: canonical durable documentation belongs
  in `wiki/`; allowed repo-local markdown is limited to root agent entry points,
  minimal app/package/plugin READMEs, chart docs/release notes, `wiki/**/*.md`,
  and agent/tooling harness files.
- Existing tracked markdown outside the allowlist is treated as legacy drift and
  warns only; newly created markdown outside the allowlist is blocked.

Why: Buntime already had auto-reindex hooks, but the remaining wiki discipline
was still behavioral. These hooks make the wiki boundary, drift visibility, and
write-as-you-go ingest prompts mechanical for both Codex and Claude Code.

## [2026-05-02] runtime | app/plugin listing names come from package metadata

Clarified that `GET /api/apps` and `GET /api/plugins` use filesystem roots only
to discover package candidates. Public names and versions come from package
metadata (`manifest.yaml`, `manifest.yml`, or `package.json`); folders without
metadata are ignored because they are outside the supported app/plugin package
format.

Why: the admin UI was mixing loaded plugin names from manifests
(`@buntime/plugin-*`) with installed plugin names derived from folder names
(`plugin-*`). The canonical identity is the package metadata; directory names
are implementation details used for discovery and filesystem operations.

## [2026-05-02] docs | launch.json names reflect runtime-serves-cpanel reality

Renamed `.claude/launch.json` entries to match what they actually do:

- `cpanel-dev` → `cpanel-watch` (build-watcher, no server — runtime serves the `dist/` output)
- `plugins-dev` → `plugins-watch` (build-watchers — runtime loads each `dist/plugin.js`)

Why: the previous `*-dev` names suggested standalone dev servers. Per [`apps/cpanel.md`](./apps/cpanel.md) and [`apps/runtime.md`](./apps/runtime.md), the CPanel is a Buntime app (not a separate server) — the runtime resolves `/cpanel/*` requests by serving the static `apps/cpanel/dist/index.html` via `serveStatic` with `<base href>` injection. The watchers only emit to disk; without the runtime running, nothing reads them.

Updated [`ops/local-dev.md`](./ops/local-dev.md#launch-configurations-claudelaunchjson) with a "Standalone?" column on the launch table, an explicit caveat for `runtime-dev` (requires pre-built `dist/` for cpanel and plugins), and a "Common workflows" guide pairing watchers with a running runtime.

## [2026-05-02] tooling | Codex QMD auto-reindex hook

- Added project-local Codex hooks for the same QMD auto-reindex rule already present in Claude Code.
- Enabled `codex_hooks` in `.codex/config.toml`, added `.codex/hooks.json`, and added `.codex/hooks/wiki-reindex.sh`.
- The Codex hook runs on `PostToolUse` for `apply_patch`/`Edit`/`Write`, detects edits to `wiki/*.md`, debounces for 3 seconds, then runs `qmd --index buntime update && qmd --index buntime embed` detached.
- Kept the existing `.claude/settings.json` and `.claude/hooks/wiki-reindex.sh` hook unchanged.
- Updated `QMD.md` so future agents know both Claude Code and Codex keep the QMD index current automatically.

## [2026-05-02] tooling | `.claude/launch.json` named launch configurations

Added 4 named launch configurations to `.claude/launch.json`, mirroring the convention from the sibling `zomme` monorepo (`<thing>-dev`, `runtimeExecutable: "bun"`, `runtimeArgs`, optional `port`):

- `buntime-dev` — root `bun run dev` (runtime + cpanel + all plugins in parallel, port 8000)
- `runtime-dev` — `@buntime/runtime` alone (watch mode, port 8000)
- `cpanel-dev` — `@buntime/cpanel` build watcher (no port; runtime serves the output)
- `plugins-dev` — all `@buntime/plugin-*` in watch mode (no port; produce `dist/plugin.js`)

These don't replace `bun run dev` or the per-workspace `--filter` invocations — they just make them addressable by name to harnesses/IDE integrations that read `.claude/launch.json`. Documented in [`ops/local-dev.md`](./ops/local-dev.md#launch-configurations-claudelaunchjson).

## [2026-05-02] tooling | Auto-reindex via Claude Code `PostToolUse` hook

Added `.claude/hooks/wiki-reindex.sh` + `.claude/settings.json` so the QMD `buntime` index stays current **without depending on agent discipline**. The hook fires on `Edit`/`Write`/`MultiEdit`/`NotebookEdit` whose `file_path` is under `wiki/*.md`, debounces in a 3-second window (a burst of N edits collapses into 1 reindex), and runs `qmd update && qmd embed` detached in the background.

Why it matters: the previous reindex was a manual step the agent had to remember after every wiki edit. Forgetting once meant queries returned stale results. The hook makes the canonical-source guarantee mechanical instead of behavioral.

What still needs the manual `buntime-refresh` alias:
- Edits made outside the Claude Code harness (direct editor, scripts, teammate pushes).
- Operations that don't touch `wiki/*.md` but should reindex (e.g. context updates via `qmd context add`).

Documented in [`QMD.md`](./QMD.md#keeping-the-index-up-to-date) under "Automatic — via Claude Code hook". Smoke-tested 2026-05-02: 581 → 594 vectors after a wiki edit, hook returned exit 0 in ~50ms (synchronous part), reindex completed in background within ~5s.

Note: the hook is portable on macOS (uses a stamp-file debounce instead of `flock`, which isn't installed by default). Requires `jq` and a `qmd` binary on PATH (the patched local install — see prerequisites in `QMD.md`).

## [2026-05-02] tests | Playwright admin E2E pattern

- Added the Playwright E2E testing pattern to `wiki/agents/testing-patterns.md`.
- Documented the value threshold for E2E tests: use them for browser + real-runtime behavior, not for cosmetic visibility checks.
- Captured the admin fixture approach: build CPanel, boot an isolated runtime per test, split built-in and uploaded app/plugin roots, validate `X-API-Key`, upload archives through the UI, verify runtime side effects, and include a prefixed API case.

## [2026-05-02] docs | QMD hyphenated semantic-query fix

- Documented the third local QMD patch required by this wiki: `vec:`/`hyde:` semantic query validation must allow hyphenated terms such as `built-in`, `multi-agent`, `gpt-4`, and `client-side`.
- Captured the exact validation rule: only reject negation when `-` starts a token, while still rejecting explicit negation such as `performance -sports`.
- Added the observed build follow-up for QMD's shared SQLite `Database` interface: declare `transaction()` because migration code already uses it.
- Added focused verification commands for the structured-search test, QMD build, CLI search smoke, and explicit-negation smoke.
- Added the Codex project-local MCP configuration (`.codex/config.toml`) alongside the existing `.mcp.json` guidance, with the reminder to avoid global MCP registration for project-specific QMD indexes.

## [2026-05-02] docs | Built-in vs uploaded app/plugin roots

- Documented the canonical source classification rule: anything shipped inside the Buntime project/image is `built-in`; only configured roots outside the project/image are `uploaded`.
- Aligned the wiki with the Docker/Helm layout: `/data/.apps` and `/data/.plugins` are built-in image roots; `/data/apps` and `/data/plugins` are custom/upload roots, usually backed by PVCs.
- Updated API, CPanel, CLI, storage, environment, and Helm references so `source` and `removable` are treated as authoritative UI/API fields.
- Clarified that built-in apps/plugins are visible in admin lists but cannot be removed; upload/delete operations must target the external custom roots.

## [2026-05-02] cleanup | Removed `wiki/AGENTS.md`; slimmed `wiki/README.md`

- **Deleted `wiki/AGENTS.md`** — was 95% identical to `wiki/README.md` and contained a stale `Read all *.md files inside .agents/rules` directive (that folder no longer exists). Agents arrive at the wiki via the root [`/CLAUDE.md`](../CLAUDE.md) (which orients them) and navigate via [`./index.md`](./index.md) (the catalog) — no third entry point needed inside the wiki.
- **Slimmed `wiki/README.md`** to a 10-line landing for GitHub-facing humans: greets the visitor, points to `index.md` / `CONVENTIONS.md` / `log.md` / `QMD.md`, and defers agent-execution rules to root `/CLAUDE.md`. Removed the duplicate workspace table (lives in `index.md`) and the stale `.agents/rules/` directive.
- **Cross-ref fixes** to references that previously pointed at `wiki/AGENTS.md`:
  - `sources/initial-ingest.md` cross-references now point at `/CLAUDE.md` for the `wiki-ingest`/`wiki-query`/`wiki-lint` flow.
  - `apps/vault.md` "References found in other wiki pages" table updated to drop the `wiki/AGENTS.md` row.

Result: agent entry-point hierarchy is now linear and unambiguous — `/CLAUDE.md` (root, eager-loaded) → `wiki/index.md` (catalog) → individual pages. No third overlapping landing page inside the wiki.

## [2026-05-02] lint | health check + `agents` audience introduced

### Automatic fixes
- Added YAML frontmatter to `sources/2026-05-01-performance-rancher-{pod-load,worker-routes}.md` (were raw reports without wiki schema; missing `title/audience/sources/updated/tags/status`).
- Added both rancher reports to `index.md` Summaries table (orphans before).
- Fixed 3 broken anchors:
  - `data/keyval-tables.md` → `apps/plugin-keyval.md#testing-and-troubleshooting` → `#tests-and-troubleshooting`
  - `data/storage-overview.md` → `apps/plugin-database.md#libsql-query-flow` → `#query-flow-libsql`
  - `/CLAUDE.md` → `wiki/apps/plugin-system.md#api-modes` → `#api-modes--persistent-vs-serverless`

### New audience and folder
- Added `audience: agents` to [`CONVENTIONS.md`](./CONVENTIONS.md) — pages whose primary consumer is an automated agent (mocking patterns, scaffolding, code-gen recipes). **Behavioral *do/don't* rules stay in `/CLAUDE.md`**, never duplicated as wiki pages.
- Created `wiki/agents/` folder with first page: [`agents/testing-patterns.md`](./agents/testing-patterns.md) — `bun:test` skeleton, `WorkerPool`/`PluginContext` mock factories, Hono `app.fetch` testing, temp-dir setup, plugin lifecycle test, error testing, anti-patterns.
- `/CLAUDE.md` now instructs the agent to **check `wiki/agents/` first** when looking for how-to recipes, falling back to `apps/` (knowledge) and proposing new `agents/` pages via `/wiki-ingest` when patterns recur.

### Audit of existing pages for `agents` audience migration
- Scanned all `apps/`, `ops/`, `data/` pages by code-block density, import statements, and "Pattern/Recipe/Scaffold/Mocking" headings.
- **Conclusion: no migration recommended.** The wiki today is overwhelmingly knowledge-prose (the *what* and *why*), not how-to recipes (the *do this*). Closest candidates were considered and rejected:
  - `apps/keyval-modeling.md` — conceptual/educational (KV mindset, versionstamp, modeling design); stays `dev`.
  - `ops/local-dev.md`, `ops/helm-charts.md`, `ops/release-flow.md`, `ops/security.md` — operational reference; stay `ops`.
  - `apps/plugin-proxy.md` — configuration examples are knowledge documentation, not templates; stays `dev`.
- Future `agents/` candidates (when written): `agents/plugin-scaffolding.md`, `agents/error-class-recipes.md`, `agents/migration-recipes.md`.

### Other checks (clean)
- Cross-refs to nonexistent files: 0 (the 2 reported by the script — `./path.md` in `CONVENTIONS.md` and `sources/initial-ingest.md` — are literal template examples in fenced regions, not real links).
- Frontmatter integrity: 100% compliant after automatic fixes.
- `updated > 90 days` stale flags: 0 (all 2026-05-02).
- Business-rule leakage in `apps/`: none (the 3 grep hits — `translate-api`, `where-to-sql.ts`, `slash` — were case-insensitive substring false positives on `SLA`).
- Audience distribution: `dev: 23`, `ops: 8`, `agents: 1`, `mixed: 1` (sources/initial-ingest), structural: 6.

### QMD reindex
After the edits above, run:

```sh
qmd --index buntime update && qmd --index buntime embed
```

(Already executed by the lint script; the index now has 40 docs / ~485 vectors.)

## [2026-05-02] refactor | Eliminated `.agents/rules/`, single `CLAUDE.md` + `AGENTS.md` symlink

Removed both `.agents/rules/` directories (root + `apps/runtime/.agents/rules/`, 17 files / ~2.6k lines total). All knowledge content (architecture, deploy, dev-setup, docker, jsr-publish, monorepo, plugins, versioning, workers — and the runtime-specific architecture/development/testing-with-buntime/project-overview/conventions) was already covered by the wiki — keeping the `.agents/rules/` versions created drift risk.

**Behavioral rules** (the *do/don't* that condition agent action) consolidated into a single section in [`/CLAUDE.md`](../CLAUDE.md) at the repo root:

- Release & publishing (never run `bump-version.ts`/`git tag`/`git push` without permission; release-notes-before-publish; never publish JSR manually from CLI)
- Testing (always run `bun test` before reporting complete; `*.test.ts` colocated)
- Code style (Biome, TS strict, trailing commas, no emojis, naming conventions, `.ts` extension in imports, `@/` alias)
- Plugin development (one API mode; base path constraints; multiple paths use `:`)
- Error handling (specific error classes from `@buntime/shared/errors`; error codes in `SCREAMING_SNAKE_CASE`; log details server-side)
- Development discipline (fix lint warnings even in untouched files; `--watch` not `--hot`)

`AGENTS.md` is now a symlink to `CLAUDE.md` — single source of truth for both.

**Knowledge gotchas** that were buried in `apps/runtime/.agents/rules/development.md` were promoted to the wiki:
- `--watch` vs `--hot` (timers/cron break with `--hot`) → [`wiki/ops/local-dev.md`](./ops/local-dev.md#tldr)
- KeyVal manual edits must use `BLOB`/`Uint8Array`, not `TEXT` → [`wiki/data/keyval-tables.md`](./data/keyval-tables.md#initialization)

PgBouncer SCRAM gotcha skipped (too niche, no anchor page).

## [2026-05-02] note | `apps/vault` confirmed as work-in-progress

User confirmed that `apps/vault` is a **planned app under active development** — the current empty-scaffolding state is intentional, not a documentation gap. Page [`apps/vault.md`](./apps/vault.md) updated to drop the "pending team confirmation" framing and state explicitly that the implementation is in progress. Page remains `status: draft` until the manifest, contracts, encryption policy, and deployment format are defined.

## [2026-05-02] setup | QMD index `buntime` provisioned

- Collection `wiki` created pointing to `wiki/` with mask `**/*.md` — 37 files indexed.
- 5 hierarchical contexts added (global, `wiki/apps`, `wiki/ops`, `wiki/data`, `wiki/sources`).
- 213 chunks embedded with multilingual model `Qwen3-Embedding-0.6B` in ~35s.
- `.mcp.json` added at the repo root pointing to `qmd --index buntime mcp` — any Claude Code session opened in this repo automatically sees the index.
- Verification: `qmd --index buntime status` confirms 37 docs / 213 vectors. Test query returns relevant results.

Recommended shell rc alias:

```sh
alias buntime-refresh='qmd --index buntime update && qmd --index buntime embed'
```

## [2026-05-02] ingest | Migration of packages/keyval/docs

Conceptual content in `packages/keyval/docs/` (15 `.adoc` files in pt-BR) **had not been absorbed** by the initial agents (which only targeted the plugin server side). Migrated to a new page:

- [`wiki/apps/keyval-modeling.md`](./apps/keyval-modeling.md) (494 lines) — KV vs RDBMS mindset, key structure (binary ordering), versionstamp, operations (CRUD/atomic/listing/transactions), features (watch/FTS/queues/expiration), modeling patterns (1-1/1-N/N-N, secondary indexes, domain patterns + multi-tenancy).

`wiki/apps/packages.md` received a cross-ref to the new page.

## [2026-05-02] ingest | Buntime wiki initialization

Creation of the Buntime project knowledge base. Consolidated all documentation from `apps/runtime/docs/`, `apps/cli/`, `apps/cpanel/`, `apps/vault/`, `plugins/*/docs/`, `plugins/*/README.{md,adoc}`, `packages/*/`, `charts/`, and `.agents/rules/` into ~30 markdown pages organized by audience.

### Pages created

**`apps/` (20 pages)**:
- Runtime and shell: `runtime.md`, `worker-pool.md`, `plugin-system.md`, `micro-frontend.md`, `runtime-api-reference.md`
- Clients: `cpanel.md`, `cli.md`, `vault.md` (draft)
- Packages: `packages.md`
- Core plugins: `plugin-database.md`, `plugin-keyval.md`, `plugin-gateway.md`, `plugin-proxy.md`, `plugin-deployments.md`, `plugin-authn.md`, `plugin-authz.md`, `plugin-logs.md`, `plugin-metrics.md`, `plugin-vhosts.md`

**`ops/` (8 pages)**: `environments.md`, `local-dev.md`, `helm-charts.md`, `release-flow.md`, `jsr-publish.md`, `logging.md`, `performance.md`, `security.md`.

**`data/` (2 pages)**: `storage-overview.md`, `keyval-tables.md`.

**`sources/`**: [`initial-ingest.md`](./sources/initial-ingest.md) (detailed summary).

**Structural**: `README.md`, `AGENTS.md`, `CONVENTIONS.md`, `index.md`, `QMD.md`, `log.md`.

### Principles applied

- **Wiki as canonical source**: pages consolidate and rewrite; they do not literally copy from sources.
- **Buntime without `business/`**: there are no business rules (purely technical runtime). Rules for products that consume the runtime live in those products' own wikis, not here.
- **Cross-refs over duplication**: plugin pages reference `plugin-system.md` instead of re-documenting hooks/manifest.
- **Tables over lists**: configs/endpoints/env vars always in tabular format.
- **en-US** for prose; **English** for identifiers.

### Ambiguities catalogued during ingest

Each agent that consolidated a slice reported contradictions between sources. Summary:

| # | Source | Contradiction | Resolution |
|---|--------|---------------|------------|
| 1 | `plugin-database` | README uses headers `x-hrana-adapter`/`-namespace`; api-reference and hrana docs use `x-database-*` | Adopted `x-database-*` (2 more consistent sources) |
| 2 | `plugin-database` | `troubleshooting.adoc` references `LIBSQL_URL_0` and `/api/database/health` (incorrect) | Rewritten to `DATABASE_LIBSQL_URL` and `/database/api/health` |
| 3 | `plugin-keyval` | `limitations.adoc` cites `KvTransaction` without retry, but the type has `maxRetries`/`retryDelay` | Discrepancy recorded in the Limitations section |
| 4 | `plugin-keyval` | `metrics.adoc` uses `?format=prometheus`; api-reference has a dedicated route `/api/metrics/prometheus` | Adopted the more recent version |
| 5 | `plugin-gateway` | Manifest has `cache.*` in the schema, but runtime has cache disabled | Documented as "schema exists, runtime disabled"; `/cache/invalidate` marked legacy |
| 6 | `plugin-gateway` | `concepts/shell-routing.md` cites `PUT /shell/excludes`, absent from api-reference and README | PUT omitted (likely outdated doc) |
| 7 | `plugin-authn` | Manifest lists `google` social provider, absent from docs | Included in the table as a note |
| 8 | `plugin-authz` | README lists 4 combining algorithms, detailed docs list 3 (`first-applicable` instead of `deny-unless-permit`/`permit-unless-deny`) | Adopted list from the 3 detailed sources and historical plan |
| 9 | `plugin-authz` | README uses duplicated path `/{base}/api/authz/*`; detailed docs use `/{base}/api/*` | Adopted the shorter path |
| 10 | `plugin-vhosts` | Docs state "single-level wildcard"; code `endsWith('.' + base)` accepts multi-level | Documented actual behavior (multi-level works) |
| 11 | `apps/runtime` | `.agents/rules/workers.md` uses "ephemeral/persistent"; docs use "TTL=0/TTL>0" | Consolidated using both vocabularies |
| 12 | `packages/shared` | `.agents/rules/errors.md` documents `ConflictError`/`InternalError`, but `errors.ts` does not export them | Recorded as a known gap with workaround `new AppError(msg, code, status)` |

### Pending items

- **QMD setup**: index `buntime` not yet created. Instructions in [`QMD.md`](./QMD.md). Owner must run `qmd --index buntime collection add . --name wiki --mask "**/*.md"` and `qmd --index buntime embed`.
- **Decide the fate of original docs**: `plugins/*/docs/`, `apps/runtime/docs/`, `packages/*/README.md` remain in the repo. Now that the wiki is the canonical source, the recommendation is: (a) remove `docs/` from plugins, (b) reduce READMEs to a pointer to the wiki, (c) move `apps/runtime/docs/` to `wiki/`. This decision should be made before the next merge to `main`.
- **`apps/vault`**: very sparse documentation. Page marked `status: draft`. Confirm with the team whether `vault` is an actual planned app or an exploration directory.
- **MCP `qmd`**: register in this repo's `.mcp.json` pointing to `--index buntime` (do not register globally).
