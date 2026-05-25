---
title: "Runbook — deploying apps, the app-shell, and proxy redirects"
audience: ops
sources:
  - apps/runtime/src/app.ts
  - plugins/plugin-gateway/plugin.ts
  - plugins/plugin-proxy/server/api.ts
  - charts/templates/configmap.yaml
updated: 2026-05-24
tags: [runbook, gateway, proxy, redirects, app-shell, rancher, deploy, example-spa]
status: stable
---

# Runbook — deploying apps, the app-shell, and proxy redirects

End-to-end operator procedure for the **Rancher-local** Buntime install (the
multipass/k3s cluster managed by the local Rancher: kubeconfig
`~/.kube/cluster.yaml`, context `home-workload`, namespace `buntime`).
Goes from "run a worker" to "front a micro-frontend shell that proxies `/api` to
a remote backend". Distilled from the `example-backend` → home-workload replication.

For contracts and internals, cross-ref [plugin-gateway](../apps/plugin-gateway.md),
[plugin-proxy](../apps/plugin-proxy.md), [helm-charts](./helm-charts.md), and
[security](./security.md#namespace-scoped-access-control).

## 0. Mental model + access

- **Workers (apps)** live under `RUNTIME_WORKER_DIRS` (`/data/.apps:/data/apps`);
  **plugins** under `RUNTIME_PLUGIN_DIRS` (`/data/.plugins:/data/plugins`).
  `/data` is a **PVC** — uploads survive pod restarts.
- The runtime's management API is under **`RUNTIME_API_PREFIX`** — on this cluster
  `/_`, so it answers at **`/_/api/...`**. This frees the bare **`/api`** path for
  a [proxy rule](#3-proxy-redirects-plugin-proxy) to claim.
- **Only a _header_ credential bypasses plugin `onRequest` hooks** (gateway shell,
  proxy, authn) — i.e. `X-API-Key` or `Authorization: Bearer` (automation). A
  **cookie** session (`buntime_api_key`, set by cpanel) does **not** bypass them,
  so logging into cpanel no longer breaks the app-shell at `/`. This was the
  source of the most confusing symptom before the fix (image ≥ `1.2.3-rc.1`,
  `hasHeaderCredential` in `app.ts`); see [Troubleshooting](#4-troubleshooting).

```bash
export KUBECONFIG=~/.kube/cluster.yaml      # context: home-workload
kubectl -n buntime get pods                        # buntime-0 + buntime-turso-0

# Reach it two ways:
#  (a) ingress (traefik):  http://buntime.example.com/
#  (b) port-forward the POD (not the Service — its selector has matched turso before):
kubectl -n buntime port-forward pod/buntime-0 8099:8000   # http://localhost:8099/
```

The runtime **root key** is in `secret/buntime` key `RUNTIME_ROOT_KEY` (the test
install uses the literal `smoke-root-key`). Send it as `X-API-Key: <root-key>`.

## 1. Run an app (worker)

### Upload

Two upload surfaces, both multipart, both gated by the runtime API key:

| Surface | Endpoint | Install path | Use when |
|---|---|---|---|
| Worker upload | `POST /_/api/workers/upload` (`file=@pkg.tgz`) | derived from `package.json` → `<dir>/<name>/<version>` (scoped: `<dir>/@scope/name/version`) | you want the package identity to drive the path |
| FileBrowser upload | `POST /_/api/workers/files/upload` (`path=apps/<name>/<version>` + `files=@pkg.zip`) | the literal `path` you give | you want an explicit path (e.g. mirror another env) |

A worker package is just `manifest.yaml` + (optional `package.json`) + the built
assets. Minimal SPA manifest:

```yaml
entrypoint: dist/index.html
visibility: public
injectBase: true
```

Example — upload a zipped app to an explicit versioned path:

```bash
RK=smoke-root-key
curl -s -X POST "http://localhost:8099/_/api/workers/files/upload" \
  -H "X-API-Key: $RK" -H "Origin: http://localhost:8099" \
  -F "path=apps/my-app/1.0.0" -F "files=@my-app.zip;filename=my-app.zip"
```

### Address

- Unscoped worker `my-app` → served at **`/my-app/...`**.
- Scoped worker `@team/my-app` → served at **`/@team/my-app/...`** (keep the `@`).
  Namespaces also gate access per API key — see
  [security](./security.md#namespace-scoped-access-control).
- A worker with an `entrypoint` gets a trailing-slash 308 (`/my-app` →
  `/my-app/`).

### Enable / disable (no restart)

```bash
curl -X POST "http://localhost:8099/_/api/workers/<scope>/<name>/<version>/disable" -H "X-API-Key: $RK" -H "Origin: http://localhost:8099"
# scope is `@team` for scoped workers, or `_` for unscoped
```

Disabled versions 404 at their base path. List installed workers:
`GET /_/api/workers`.

## 2. Gateway app-shell (micro-frontend)

The app-shell makes **all browser navigations** render through one central shell
app (e.g. `example-spa`), which then loads the target app in an iframe. Excluded
apps (`cpanel`) render standalone.

### Config (Helm)

`GATEWAY_SHELL_DIR` comes from `plugins.gateway.shellDir`; excludes from
`plugins.gateway.shellExcludes` (default `cpanel`). Changing them rewrites the
configmap and **needs a pod roll** (the gateway reads the env at init):

```bash
helm upgrade buntime ./charts --namespace buntime --reuse-values \
  --set image.tag=<current-tag> \
  --set plugins.gateway.shellDir=/data/apps/example-spa/1.0.0 \
  --set plugins.gateway.shellExcludes=cpanel \
  --wait
```

> Always re-pass `--set image.tag=<current-tag>` with `--reuse-values` so the
> upgrade keeps the running image instead of the chart default.

### Deploy `example-spa` as the shell (worked example)

1. Build the shell app (it ships a `dist/` + `manifest.yaml`).
2. Zip `manifest.yaml package.json dist` and FS-upload to
   `apps/example-spa/1.0.0` (mirrors the `example-backend` path
   `/data/apps/example-spa/1.0.0`).
3. `helm upgrade … --set plugins.gateway.shellDir=/data/apps/example-spa/1.0.0`.
4. Verify a browser navigation renders the shell:

```bash
curl -s http://buntime.example.com/ -H "Sec-Fetch-Dest: document" | grep -i '<title>'
# -> <title>Platform</title>   (the example-spa shell)
curl -sI http://buntime.example.com/chunk-<hash>.js   # 200, shell asset served from shellDir
curl -sI http://buntime.example.com/cpanel/ -H "Sec-Fetch-Dest: document"  # cpanel renders standalone (excluded)
```

### How the shell decides to serve

From `plugin-gateway` `onRequest`: it serves the shell when
`!isApiRoute && !shouldBypass && (isDocument || (isRootPath && !isFrameEmbedding))`,
where `isApiRoute` is matched against the **runtime** API path (`/_/api`),
`isDocument` = `Sec-Fetch-Dest: document`, and `isRootPath` = a **single-segment**
path. Consequences:

- A real `fetch('/api/users')` (multi-segment, `Sec-Fetch-Dest: empty`) is **not**
  shell-served → it falls through to the proxy.
- A bare single-segment path (`/api`, `/foo`) **is** shell-served as a navigation.
  Harmless — apps call multi-segment API paths.

> **Auth gotcha (fixed in `1.2.3-rc.1`):** only a **header** credential
> (`X-API-Key` / `Authorization: Bearer`) skips plugin `onRequest` hooks — that is
> the automation path. A **cookie** session (`buntime_api_key` from a cpanel login)
> does **not**, so you can be logged into cpanel and still get the shell at `/` in
> the same browser. Before the fix the cookie also skipped the hooks, so `/`
> returned `Not Found` for anyone with a cpanel session — if you see that, the
> runtime image predates the fix (workaround then: clear the cookie via
> `fetch('/_/api/admin/session',{method:'DELETE',credentials:'include'})`).

CORS (`plugins.gateway.cors.origin`, default `*`) and rate-limit
(`plugins.gateway.rateLimit.requests`/`window`) are set the same way.

## 3. Proxy redirects (plugin-proxy)

`plugin-proxy` matches the request **pathname** against ordered rules and forwards
the first match to a target (`changeOrigin`, `${ENV_VAR}`, path `rewrite`),
short-circuiting the pipeline. Two rule kinds:

- **Static** — in `plugins/plugin-proxy/manifest.yaml` (`rules:`). Baked into the
  image, always present, read-only at runtime.
- **Dynamic** — via the REST API, persisted in proxy-owned Turso tables.

### Management API — `/redirects/admin/*` (NOT `/api`)

The admin API is mounted at **`/redirects/admin/rules`** (`.basePath("/admin")`).
Hitting `/redirects/api/rules` returns the plugin SPA, not JSON. Auth = the
runtime root key (or an `admin`/`editor` store key) via `X-API-Key`/`Bearer`;
these routes are outside the `/_/api` CSRF surface so no `Origin` is required.

```bash
RK=smoke-root-key
# Create: /api/* -> https://backend.example.com/api/*
curl -s -X POST http://localhost:8099/redirects/admin/rules \
  -H "X-API-Key: $RK" -H "Content-Type: application/json" -d '{
    "name": "Example Backend API",
    "pattern": "^/api(/.*)?$",
    "target": "https://backend.example.com",
    "rewrite": "/api$1",
    "changeOrigin": true, "secure": true
  }'
# List:
curl -s http://localhost:8099/redirects/admin/rules -H "X-API-Key: $RK" | jq '.[] | {name,pattern,target}'
```

Verify it forwards (a proxied response carries the **backend's** status/headers and
has **no** `x-request-id`; a runtime response always has `x-request-id`):

```bash
curl -sI http://localhost:8099/api/health -H "Sec-Fetch-Dest: empty"
# -> 401 application/problem+json, no x-request-id  (reached example-backend)
curl -sI http://localhost:8099/_/api/health -H "X-API-Key: $RK"
# -> 200, x-request-id present  (runtime intact)
```

> **Durability (fixed in app `1.2.2+`):** dynamic rules now survive pod restarts.
> `TursoService.transaction()` pushes the replica to `buntime-turso` after each
> commit in sync mode, so a `POST /redirects/admin/rules` is durable — verified by
> creating rules, `kubectl delete pod buntime-0`, and re-listing (all rules
> present). On older images a dynamic rule was lost on restart; if you see that,
> upgrade. See [plugin-turso](../apps/plugin-turso.md#push-after-commit-durability).

### Other shell API routes

The `example-spa` manifest declares more `PUBLIC_*` API bases. On this cluster
they are all proxied to the same `example-backend` backend (path-preserving), so the
shell's calls resolve:

| Path | Rule pattern | Target |
|---|---|---|
| `/api/*` | `^/api(/.*)?$` | `https://backend.example.com` (`rewrite /api$1`) |
| `/gestor-licencas-api/*` | `^/gestor-licencas-api(/.*)?$` | same (`rewrite /gestor-licencas-api$1`) |
| `/gestao-pessoas-api/*` | `^/gestao-pessoas-api(/.*)?$` | same (`rewrite /gestao-pessoas-api$1`) |
| `/a/*` (incl. `/a/translate-api`) | `^/a(/.*)?$` | same (`rewrite /a$1`) |

All `changeOrigin: true`, `secure: true`. To point at a different backend, change
the `target`.

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/` returns plain `Not Found` in the browser, but `curl` (no auth) shows the shell | Runtime image **predates `1.2.3-rc.1`**: a `buntime_api_key` cpanel cookie was treated like a header credential and skipped the shell `onRequest` | Upgrade the image (cookie sessions no longer bypass `onRequest`). Stopgap on old images: clear the cookie via `fetch('/_/api/admin/session',{method:'DELETE',credentials:'include'})` then reload |
| App-shell SPA renders but a sub-resource 404s (`/workers/x.js`, `/assets/x.js`) | Multi-segment asset path not routed to the shell worker (only document + single-segment paths are) | Emit the asset at a single-segment root path; see [`spa-as-app-shell`](../agents/spa-as-app-shell.md) |
| Dynamic proxy rule gone after `helm upgrade`/restart | Turso sync-mode durability | Re-`POST` the rule; for permanence use a static manifest rule |
| `GET /redirects/api/rules` returns HTML, not JSON | Wrong path — API is `/redirects/admin/rules` | Use `/admin`, not `/api` |
| `GET /api` (bare) returns the shell instead of proxying | Single-segment path is treated as a navigation by the shell | Expected; real calls use multi-segment `/api/...` which proxy correctly |
| Worker uploaded but not reachable at its URL | Wrong name/version path or missing `@scope` segment | Check `GET /_/api/workers`; address scoped apps at `/@scope/name` |
| Intermittent `Not Found` via the Service | `buntime` Service selector has matched the turso pod historically | `kubectl get endpoints buntime` should list only `buntime-0`; port-forward the pod directly |
| `helm upgrade` rolled to the chart's default image | Forgot `--set image.tag` with `--reuse-values` | Always pass the current tag |
