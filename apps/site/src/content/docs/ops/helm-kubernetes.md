---
title: Helm & Kubernetes
description: Chart structure, generation scripts, mandatory principles, most-used values, Rancher integration, and database service deployment.
sidebar:
  order: 6
---

Chart structure under `charts/`, generation scripts, mandatory principles (volumes, defaults), most-used values, Rancher integration, and database service deployment.

For chart versioning and publishing, see [Release flow](/ops/release-flow/). For environment variables that become ConfigMap entries, see [Environment variables](/ops/environment/).

## Structure

```
charts/
├── buntime/
│   ├── Chart.yaml
│   ├── values.yaml              # AUTO-GENERATED
│   ├── values.base.yaml         # edit for runtime config
│   ├── configmap.base.yaml      # edit for runtime env vars
│   ├── questions.yml            # AUTO-GENERATED (Rancher UI)
│   ├── questions.base.yaml      # edit for runtime questions
│   ├── release-notes.md         # injected as annotation
│   └── templates/
│       ├── configmap.yaml                          # AUTO-GENERATED (base + manifests)
│       ├── statefulset.yaml                        # runtime pods (StatefulSet + volumeClaimTemplate state)
│       ├── ingress.yaml                            # ingress (if host is set)
│       ├── pvc.yaml                                # shared PVCs /data/apps and /data/plugins (RWX)
│       ├── route.yaml                              # OpenShift Route (optional)
│       ├── secret.yaml                             # runtime + Litestream secrets
│       ├── service.yaml                            # ClusterIP + headless Service
│       ├── turso-primary.yaml                      # OPTIONAL self-hosted Turso server primary
│       └── turso-primary-litestream-config.yaml    # OPTIONAL Litestream sidecar config
└── turso/                       # Target: Turso sync/remote service chart replacing legacy LibSQL
```

:::note
The runtime pod is a **StatefulSet** (not a Deployment) so each replica gets its own RWO PVC for `/data/state` (api-keys.db). Shared filesystems (`/data/apps`, `/data/plugins`) remain as regular RWX PVCs. See [Multi-pod deployment](/ops/multi-pod/) for the full architecture.
:::

The distinction between `values.base.yaml`/`values.yaml` (and equivalents) is intentional:

| File | Edit? | Contents |
|------|-------|----------|
| `values.base.yaml` | Yes | Runtime config — replicaCount, image, persistence, ingress, `buntime.*` |
| `values.yaml` | **No** | Result of merging `base + plugins/*/manifest.yaml` |
| `configmap.base.yaml` | Yes | Runtime env vars without Helm templating |
| `templates/configmap.yaml` | **No** | Generated from `configmap.base.yaml` + manifests |
| `questions.base.yaml` | Yes | Runtime-specific questions |
| `questions.yml` | **No** | Generated from `questions.base.yaml` + manifests |

## Generation

```bash
# Generate everything (values + configmap + questions)
bun scripts/generate-helm.ts

# Individual generators
bun scripts/generate-helm-values.ts
bun scripts/generate-helm-configmap.ts
bun scripts/generate-helm-questions.ts
```

### When to regenerate

| Change | Regenerate? |
|--------|-------------|
| Edited `plugins/*/manifest.yaml` | **Yes** |
| Added/removed a core plugin | **Yes** |
| Edited `charts/buntime/values.base.yaml` | **Yes** |
| Edited `charts/buntime/configmap.base.yaml` | **Yes** |
| Edited a template only (`templates/*.yaml`) | No |
| Changed code in apps/runtime or plugins | No (chart does not change, only the image) |

After regenerating: bump the chart version (see [Release flow](/ops/release-flow/)).

## Principles

### 0. Workload kind: Deployment vs StatefulSet

The Buntime runtime chart currently uses a `Deployment`. That should remain the default because runtime pods are compute workers, not the authoritative owner of a database. The Turso service chart that replaces the legacy LibSQL chart should use a `StatefulSet`, because it owns the durable sync/remote endpoint and its canonical database volume.

| Workload | Recommended kind | Why |
|----------|------------------|-----|
| Buntime runtime | `Deployment` by default | Stateless compute process; easier rolling updates and autoscaling |
| Turso sync/remote service | `StatefulSet` | Owns durable database files and needs stable storage identity |
| Runtime local Turso sync cache | `emptyDir` at `/data/turso` | Cache is local to a pod; do not share one file across pods |
| `/data/apps` and `/data/plugins` | Shared PVCs, not per-pod StatefulSet volumes | They are shared code/artifact stores; per-pod volumes would diverge |

If runtime sync caches must survive pod rescheduling or a temporary Turso sync outage, introduce a per-pod database volume. That can be done with a runtime `StatefulSet`, but it is a trade-off: the runtime becomes identity-bound and less flexible to autoscale. The preferred baseline is `Deployment` plus `pushOnWrite`/`pullOnStart`; only switch the runtime to StatefulSet if unsynced local writes must survive pod loss.

**Runtime is a StatefulSet.** The runtime pod is provisioned as a StatefulSet so each replica gets its own RWO PVC for `/data/state` (api-keys.db). The shared volumes for **apps and plugins remain regular PVCs** — they need `ReadWriteMany` when `replicaCount > 1` (or a future artifact-distribution model). With `ReadWriteOnce` only, run one replica.

### 1. Volumes are mandatory

`/data/plugins`, `/data/apps`, and `/data/state` are **always** mounted. No conditionals.

```yaml
# templates/statefulset.yaml — correct
volumeMounts:
  - name: plugins
    mountPath: /data/plugins
  - name: apps
    mountPath: /data/apps
  - name: state
    mountPath: /data/state
volumes:
  - name: plugins
    persistentVolumeClaim:
      claimName: {{ include "buntime.fullname" . }}-plugins
  - name: apps
    persistentVolumeClaim:
      claimName: {{ include "buntime.fullname" . }}-apps
# /data/state comes from volumeClaimTemplates — one PVC per pod, RWO.
volumeClaimTemplates:
  - metadata:
      name: state
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: {{ .Values.persistence.state.size }}
```

Why: the runtime depends on the paths `/data/.apps:/data/apps` and `/data/.plugins:/data/plugins` (defaults). If the PVC disappears, `RUNTIME_WORKER_DIRS`/`RUNTIME_PLUGIN_DIRS` break in a cascade.

### 2. Core plugins must have env vars with defaults

Enabled plugins (turso, gateway, proxy, keyval) cannot use `{{- if .Values.X }}` for their main env vars.

```yaml
# CORRECT — always defines with a default
TURSO_MODE: {{ .Values.plugins.turso.mode | default "local" | quote }}
GATEWAY_CORS_ORIGIN: {{ .Values.plugins.gateway.cors.origin | default "*" | quote }}

# WRONG — conditional for a core plugin
{{- if .Values.plugins.turso.mode }}
TURSO_MODE: {{ .Values.plugins.turso.mode | quote }}
{{- end }}
```

Accepted exceptions (conditional ok):

| Type | Why |
|------|-----|
| `boolean` | Only set if `true` |
| `array` (replicas) | Replicas are optional |
| `password`/`token` | Auth tokens are optional |

### 3. `/data` directories in the pod

Recap (more detail in [Environment variables](/ops/environment/)):

| Path | Origin | Contents |
|------|--------|----------|
| `/data/.apps` | Image | Core apps |
| `/data/.plugins` | Image | Core plugins |
| `/data/apps` | PVC | External apps (deploys) |
| `/data/plugins` | PVC | External plugins |

Runtime source classification follows this split. `/data/.apps` and
`/data/.plugins` are built-in and cannot be removed through the API; `/data/apps`
and `/data/plugins` are uploaded/custom roots and can be changed by the admin UI
or CLI when the caller has the matching permission.

## Most-used values

### Runtime

| Path | Default | Description |
|------|---------|-------------|
| `replicaCount` | `1` | Use ≥2 only with `ReadWriteMany` PVC |
| `image.repository` | `ghcr.io/djalmajr/buntime` | Switch to `registry.example.com/zomme/buntime` for the GitLab flow |
| `image.tag` | `latest` | `latest`, `{version}`, `{major}.{minor}`, or a custom tag |
| `image.pullPolicy` | `Always` | Use `IfNotPresent` when importing the image directly into k3s |
| `imagePullSecrets` | `[]` | Required for self-hosted GitLab (`gitlab-registry`) |
| `service.type` | `NodePort` | Switch to `ClusterIP` when using Ingress |
| `service.port` | `8000` | Service port |

### `buntime.*` block

| Path | Default | Description |
|------|---------|-------------|
| `buntime.apiPrefix` | `/_` | Prefixes only `/api/*` (becomes `/_/api/*`); plugin routes are unchanged |
| `buntime.logLevel` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `buntime.masterKey` | `""` | High-privilege deploy key; stored as a Secret when set |
| `buntime.ephemeralConcurrency` | `2` | Maximum `ttl: 0` concurrency |
| `buntime.ephemeralQueueLimit` | `100` | Maximum `ttl: 0` queue depth |
| `buntime.pluginDirs` | `/data/.plugins:/data/plugins` | PATH style |
| `buntime.poolSize` | `100` | Pool size in production |
| `buntime.workerConfigCacheTtlMs` | `1000` | Worker manifest cache |
| `buntime.workerResolverCacheTtlMs` | `1000` | Resolved directory cache |
| `buntime.port` | `8000` | `Bun.serve` port |
| `buntime.workerDirs` | `/data/.apps:/data/apps` | PATH style |

### `plugins.turso.*` block

The runtime chart now enables `@buntime/plugin-turso` by default and disables the legacy `@buntime/plugin-database` manifest. `plugins.turso.*` values are generated from `plugins/plugin-turso/manifest.yaml`; do not reintroduce `plugins.database.libsql*` or `DATABASE_LIBSQL_*` chart wiring.

| Path | Default | Description |
|------|---------|-------------|
| `plugins.turso.mode` | `local` | `local` or `sync`; Kubernetes multi-pod deployments should use `sync` |
| `plugins.turso.localPath` | `/data/turso/runtime.db` | Local Turso database file used by both modes |
| `plugins.turso.sync.url` | `""` | Turso sync endpoint URL; required when mode is `sync` |
| `plugins.turso.sync.authToken` | `""` | Optional Turso sync auth token |

In `sync` mode each runtime pod must keep its own local Turso file and synchronize through the endpoint. Do not point multiple runtime pods at one shared database file on RWX storage.

The runtime chart mounts `/data/turso` as `emptyDir`. This makes the Turso local file a pod-local cache, which is the desired Kubernetes baseline for `sync` mode. Plain `local` mode in Kubernetes is therefore suitable only for disposable/single-pod environments unless a future per-pod PVC option is added.

### Persistence

| Path | Default | Description |
|------|---------|-------------|
| `persistence.plugins.size` | `5Gi` | External plugins PVC size |
| `persistence.plugins.accessMode` | `ReadWriteMany` | Use `ReadWriteOnce` if `replicaCount=1` |
| `persistence.plugins.storageClass` | `""` | Empty = use cluster default |
| `persistence.apps.size` | `10Gi` | Apps PVC size |
| `persistence.apps.accessMode` | `ReadWriteMany` | Same as above |
| `persistence.apps.storageClass` | `""` | Same as above |

:::caution[Standard k3s]
The `local-path-provisioner` does **not** support `ReadWriteMany`. For `replicaCount > 1`, use NFS, Longhorn, or another StorageClass with RWX.
:::

### Ingress (Kubernetes/Traefik/Nginx)

| Path | Default | Description |
|------|---------|-------------|
| `ingress.host` | `""` | Hostname (empty disables Ingress) |
| `ingress.className` | `traefik` | `nginx`, `traefik`, `alb`, etc. |
| `ingress.path` | `/` | Use `/b` for automatic rewrite in path-based routing |
| `ingress.maxBodySize` | `100m` | Applied as nginx annotation |
| `ingress.tls.enabled` | `false` | Enable HTTPS |
| `ingress.tls.secretName` | `""` | Auto-generated if empty |
| `ingress.annotations` | `{}` | E.g., `cert-manager.io/cluster-issuer: home-ca-issuer` |

### Route (OpenShift/OKD)

| Path | Default | Description |
|------|---------|-------------|
| `route.enabled` | `false` | Enable |
| `route.host` | `""` | Hostname |
| `route.tls.enabled` | `true` | TLS |
| `route.tls.termination` | `edge` | `edge` \| `passthrough` \| `reencrypt` |

### Resources and autoscaling

| Path | Default |
|------|---------|
| `resources.requests.cpu` | `250m` |
| `resources.requests.memory` | `256Mi` |
| `resources.limits.cpu` | `2` |
| `resources.limits.memory` | `1Gi` |
| `autoscaling.enabled` | `false` |
| `autoscaling.minReplicas` | `1` |
| `autoscaling.maxReplicas` | `5` |
| `autoscaling.targetCPUUtilizationPercentage` | `70` |
| `autoscaling.targetMemoryUtilizationPercentage` | `80` |
| `podDisruptionBudget.enabled` | `false` |
| `podDisruptionBudget.minAvailable` | `1` |

## Common commands

```bash
# Install
helm install buntime ./charts/buntime -n zomme -f values-k3s.yaml

# Upgrade preserving values
helm upgrade buntime ./charts/buntime -n zomme --reuse-values --set buntime.apiPrefix=/_

# Status
helm status buntime -n zomme
helm -n zomme get values buntime

# ConfigMap (after templating)
kubectl -n zomme get configmap buntime -o yaml

# Pod / volumes
kubectl -n zomme exec deployment/buntime -- ls -la /data/

# Logs
kubectl logs -n zomme -l app.kubernetes.io/name=buntime -f --tail=100

# Restart
kubectl -n zomme rollout restart deployment/buntime

# Uninstall (keeps PVCs)
helm uninstall buntime -n zomme
kubectl -n zomme delete pvc -l app.kubernetes.io/name=buntime  # optional
```

## Deploying an external plugin to the cluster

Plugins outside the monorepo must be copied to the `/data/plugins` PVC:

```bash
POD=$(kubectl -n zomme get pods -l app=buntime -o jsonpath='{.items[0].metadata.name}')

kubectl -n zomme exec $POD -- mkdir -p /data/plugins/plugin-foo/dist
kubectl -n zomme cp /path/to/plugin-foo/manifest.yaml \
  $POD:/data/plugins/plugin-foo/
kubectl -n zomme cp /path/to/plugin-foo/dist/plugin.js \
  $POD:/data/plugins/plugin-foo/dist/

kubectl -n zomme rollout restart deployment/buntime
```

## Rancher

### Adding a chart repository

1. **Apps > Repositories > Create**
2. Index URL: `https://github.com/zommehq/charts.git` (or the GitLab equivalent)
3. Path: `/charts` when pulling directly from the mono

### Installing buntime

1. **Apps > Charts > buntime > Install**
2. Namespace: `zomme` (recommended for all services)
3. Paste `values-k3s.yaml` into the YAML tab or edit via `questions.yml`

Critical fields for k3s:

| Field | Value | Why |
|-------|-------|-----|
| `ingress.host` | `buntime.home` | Enables the Ingress |
| `ingress.className` | `traefik` | k3s default |
| `ingress.tls.enabled` | `true` | HTTPS |
| `ingress.annotations` | `cert-manager.io/cluster-issuer: home-ca-issuer` | cert-manager TLS |

### Upgrade detected

When the chart is published with a higher `version` in `Chart.yaml`, Rancher shows **"Upgrade Available"**. The versioning flow is described in [Release flow](/ops/release-flow/).

## Turso service chart target

The runtime chart exposes Turso settings through generated `plugins.turso.*` values and generated `TURSO_*` ConfigMap entries. Buntime runtime pods should not embed a cluster-shared database file and should not depend on legacy LibSQL wiring.

The target modes are:

| Mode | Runtime pod behavior | Cluster service |
|------|----------------------|-----------------|
| `local` | Opens a local Turso database file | None; local tests and single-pod deployments only |
| `sync` | Opens a local file and synchronizes with a remote sync endpoint | Turso sync server pod/StatefulSet, unless using an external Turso Cloud endpoint |
| `remote` | Sends SQL over HTTP without a local file | Turso HTTP endpoint, either in-cluster or external |

For self-hosted Kubernetes/Rancher, both `sync` and `remote` need an endpoint service. In the local cluster, that means a Turso StatefulSet/service replacing the legacy LibSQL chart. For Turso Cloud, the chart only needs URL/token configuration and no in-cluster Turso pod.

The sync server model uses the Turso `tursodb` sync server (`tursodb ./server.db --sync-server 0.0.0.0:8080`) with its own PVC. Runtime pods use separate local database files and sync through that service instead of sharing one file through RWX storage.

Legacy LibSQL behavior, kept here only as historical context, was:

| Resource | Role |
|----------|------|
| StatefulSet | Pod with persistent volume (`/var/lib/sqld`) |
| Service | `http://libsql:8080` (HTTP) and `:5001` (gRPC) |
| ConfigMap | `SQLD_NODE: primary`, ports |
| Secret | `SQLD_AUTH_JWT_KEY` in production |

Do not model future Turso deployment as LibSQL primary/replica (`SQLD_NODE`, `SQLD_PRIMARY_URL`). Turso Sync is explicit push/pull around local Turso database files, and the runtime chart exposes Turso-oriented values instead of `DATABASE_LIBSQL_*`.

## Troubleshooting

| Symptom | Where to look |
|---------|---------------|
| Pod in `Pending` | `kubectl describe pod` — usually PVC without a StorageClass |
| `ImagePullBackOff` | imagePullSecrets in the namespace + correct image.repository |
| Probe failing | `/api/health/live` and `/api/health/ready` must respond; `RUNTIME_API_PREFIX` changes these paths |
| `Plugin X requires Y` | Y must be enabled in the manifest (see [Environment variables](/ops/environment/)) |
| Missing cert | `kubectl get certificate -n zomme` + cert-manager logs |
| Turso service unreachable | Check the configured Turso service URL from the runtime pod; legacy clusters may still use `http://libsql:8080/health` until migrated |
