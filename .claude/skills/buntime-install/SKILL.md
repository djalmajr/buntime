---
name: buntime-install
description: >-
  Install/bootstrap a Buntime runtime from scratch (Kubernetes via the bundled
  Helm chart, or local/Docker) and understand its API-key auth model — the root
  key vs generated `btk_*` keys, roles/namespaces, and how the cpanel (browser)
  and the MCP/CLI authenticate (cookie+CSRF vs `X-API-Key`+`Origin`). Use when
  standing up a new Buntime environment, generating/scoping API keys, or wiring
  the MCP or cpanel against a runtime. After install, use the
  `buntime-provision-app` skill to deploy apps.
---

# Buntime: install from scratch + API-key auth

Buntime is a Bun+Hono runtime (worker pool + plugin system + gateway app-shell).
It ships a Helm chart at `charts/` and a Docker image at `ghcr.io/djalmajr/buntime`.
This skill covers bringing a runtime up and the credential model needed to manage it.

## 1. Install on Kubernetes (Helm)

The chart is in-repo at `charts/`. Minimum viable install:

```bash
kubectl create namespace buntime

# Root key = the bootstrap/automation credential (see §4). Generate a strong one:
ROOT_KEY=$(openssl rand -hex 32)

helm install buntime ./charts -n buntime \
  --set buntime.rootKey="$ROOT_KEY" \
  --set image.pullPolicy=IfNotPresent      # Always (default) re-pulls ghcr every restart
# For a local-path / single-node cluster (k3s/Rancher Desktop), the default
# storage class is RWO only — the apps/plugins PVCs MUST be ReadWriteOnce:
#   --set persistence.apps.accessMode=ReadWriteOnce \
#   --set persistence.plugins.accessMode=ReadWriteOnce

kubectl -n buntime get statefulset,pvc,svc          # verify
kubectl -n buntime port-forward svc/buntime 8000:8000   # reach it locally
curl -s http://localhost:8000/.well-known/buntime    # {"api":"/_/api","version":"x"}
```

Notes:
- `image.tag` is empty by default and resolves to the chart version; pin it for reproducibility.
- `service.type` defaults to `NodePort` (random 30000–32767 port, reassigned per
  redeploy — fine for a lab, not production). Use `ingress.host` + `ingress.className`
  (traefik default) or a `LoadBalancer` for real environments.
- The chart values live in `charts/values.base.yaml` (and `charts/questions.*` document each).

## 2. Install locally (Bun / Docker)

```bash
bun install
export RUNTIME_ROOT_KEY=dev-root-key            # optional locally; without ANY key, auth = 401
export RUNTIME_PLUGIN_DIRS=/data/.plugins:/data/plugins   # PATH-style ":" (never ",")
export RUNTIME_WORKER_DIRS=/data/.apps:/data/apps
bun run dev                                       # use --watch, NOT --hot (breaks cron/timers)
curl -s http://localhost:8000/.well-known/buntime
```

Docker: `docker compose --profile dev up` (source-mounted hot reload) or
`--profile prod` (multi-stage Dockerfile build).

## 3. Configuration that matters

| Chart value (`buntime.*` unless noted) | Purpose |
|---|---|
| `rootKey` | Bootstrap key → K8s Secret key `RUNTIME_ROOT_KEY` on the StatefulSet. |
| `apiPrefix` | Mounts the management API at `{prefix}/api`. Default `/_` → `/_/api`; `/` → `/api`. |
| `pluginDirs` | `RUNTIME_PLUGIN_DIRS`, `:`-separated. Default `/data/.plugins:/data/plugins` (`.plugins` = core in-image; `/plugins` = custom on PVC). |
| `workerDirs` | `RUNTIME_WORKER_DIRS`, `:`-separated. Default `/data/.apps:/data/apps`. |
| `image.{repository,tag,pullPolicy}` | `ghcr.io/djalmajr/buntime`; tag → chart version; pullPolicy `Always`. |
| `persistence.{apps,plugins}.accessMode` | `ReadWriteMany` for NFS/Longhorn; **`ReadWriteOnce` for local-path**. |
| `service.type` / `ingress.host` | Exposure. |

**API discovery:** clients GET the unauthenticated `/.well-known/buntime` →
`{ api, version }`; `api` is the management root (e.g. `/_/api`). The MCP and
`RuntimeClient` use this to avoid hardcoding the prefix.

## 4. API-key auth model

Two credential kinds:

- **Root key** (`RUNTIME_ROOT_KEY`): a master key with full admin access (all
  permissions, all namespaces). It is compared in plain text and is NOT in the key
  store, so it cannot be revoked — treat it as a secret, use it for bootstrap and
  automation. When present, a request bearing it becomes the `root` principal
  (`id=0`, `isRoot=true`) and bypasses all role/namespace checks.
- **Generated keys** (`btk_*`): created against the store, format
  `btk_<base64url(32 bytes)>`. Stored **hashed** (SHA-256); the plaintext is shown
  exactly once at creation. Soft-revoked (kept with a `revoked_at`).

**Roles** (`KEY_ROLES`): `admin` (all), `editor` (default — all except `keys:*`),
`viewer` (`workers:read`, `plugins:read`, `keys:read`), `custom` (explicit
permission list). Permissions are `workers:{read,install,remove,restart}`,
`plugins:{read,install,remove,config}`, `keys:{read,create,revoke}`.

**Namespaces** scope which artifacts a key may touch: `["*"]` (default, all) or
`["@scope"]` (e.g. `@acme/*`). Enforced server-side
(`principalCanAccessNamespace`); root/admin imply `*`. So the MCP advertises every
tool, but the runtime rejects whatever the key's role/namespaces disallow — same as
the cpanel showing all UI while the runtime decides.

**Create / revoke:** `POST {api}/keys` `{name, role?, permissions?, namespaces?,
expiresIn?}` → returns the plaintext once. `DELETE {api}/keys/:id`. Via the MCP:
`create_key` / `revoke_key`. Via the cpanel: the API-keys admin screen.

## 5. cpanel (browser) vs MCP (CLI) auth

- **cpanel**: `POST {api}/admin/session {key}` → sets an HttpOnly, `SameSite=Strict`
  cookie `buntime_api_key`; the browser sends it on same-origin requests.
  `GET {api}/admin/session` probes it; `DELETE` logs out. Because it's a cookie
  session, state-changing requests are CSRF-checked: the request `Origin` must match
  the `Host`.
- **MCP / CLI**: send the key as `X-API-Key` plus an `Origin` header. A header
  credential sets `auth.valid=true`, which **short-circuits the CSRF/Origin check**
  (CLIs can't be victims of browser CSRF). The MCP reads `BUNTIME_URL`,
  `BUNTIME_API_KEY`, optional `BUNTIME_ORIGIN` (defaults to the URL origin) and
  `BUNTIME_API_PATH` (else discovered). See `apps/mcp/README.md`.

`Origin` must therefore be sent on all mutating MCP calls; the `RuntimeClient`
always includes it.

## 6. Gotchas

- No key set AND empty store → every request is `401 AUTH_REQUIRED`. Set `rootKey`
  (chart) / `RUNTIME_ROOT_KEY` (local) to bootstrap.
- local-path storage is RWO-only: an immutable RWM PVC leaves the pod `Pending`;
  fixing the accessMode needs `helm uninstall` + deleting the Pending PVCs.
- `image.pullPolicy: Always` re-pulls on every restart; use `IfNotPresent` for an
  imported/dev image.
- Dev runtime: `bun --watch`, never `--hot` (croner won't fire; leaks port bindings).
- Root key is never hashed/revocable — keep it in a Secret/secrets-manager, never in git.

## Related

- After install, deploy apps with the **`buntime-provision-app`** skill.
- Operational runbooks (local km-nginx lab, dev-image→k3s) live in ai-memory
  `djalmajr/infra`; the auth/key contract in ai-memory `zommehq/buntime`.
