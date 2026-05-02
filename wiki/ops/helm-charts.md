---
title: "Helm charts and Kubernetes deploy"
audience: ops
sources:
  - .agents/rules/deploy.md
  - apps/runtime/docs/deployment/kubernetes.md
  - apps/runtime/docs/deployment/k3s-rancher.md
  - charts/values.base.yaml
  - charts/Chart.yaml
updated: 2026-05-02
tags: [helm, k8s, charts, rancher]
status: stable
---

# Helm charts and Kubernetes deploy

> Chart structure under `charts/`, generation scripts, mandatory principles (volumes, defaults), most-used values, Rancher integration, and the LibSQL StatefulSet.

For chart versioning and publishing, see [Release flow](./release-flow.md). For environment variables that become ConfigMap entries, see [Environments](./environments.md).

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
│       ├── configmap.yaml       # AUTO-GENERATED (base + manifests)
│       ├── deployment.yaml      # pod spec + volume mounts
│       ├── ingress.yaml         # ingress (if host is set)
│       ├── pvc.yaml             # PVCs /data/apps and /data/plugins
│       ├── route.yaml           # OpenShift Route (optional)
│       ├── secret.yaml          # secrets (optional)
│       └── service.yaml         # Service
└── libsql/                      # LibSQL StatefulSet
```

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

After regenerating: bump the chart version (see [Release flow](./release-flow.md)).

## Principles

### 1. Volumes are mandatory

`/data/plugins` and `/data/apps` are **always** mounted. No conditionals.

```yaml
# templates/deployment.yaml — correct
volumeMounts:
  - name: plugins
    mountPath: /data/plugins
  - name: apps
    mountPath: /data/apps
volumes:
  - name: plugins
    persistentVolumeClaim:
      claimName: {{ include "buntime.fullname" . }}-plugins
  - name: apps
    persistentVolumeClaim:
      claimName: {{ include "buntime.fullname" . }}-apps
```

Why: the runtime depends on the paths `/data/.apps:/data/apps` and `/data/.plugins:/data/plugins` (defaults). If the PVC disappears, `RUNTIME_WORKER_DIRS`/`RUNTIME_PLUGIN_DIRS` break in a cascade.

### 2. Core plugins must have env vars with defaults

Enabled plugins (database, gateway, deployments, proxy, keyval) cannot use `{{- if .Values.X }}` for their main env vars.

```yaml
# CORRECT — always defines with a default
DATABASE_LIBSQL_URL: {{ .Values.plugins.database.libsqlUrl | default "http://libsql:8080" | quote }}
GATEWAY_CORS_ORIGIN: {{ .Values.plugins.gateway.cors.origin | default "*" | quote }}

# WRONG — conditional for a core plugin
{{- if .Values.plugins.database.libsqlUrl }}
DATABASE_LIBSQL_URL: {{ .Values.plugins.database.libsqlUrl | quote }}
{{- end }}
```

Accepted exceptions (conditional ok):

| Type | Why |
|------|-----|
| `boolean` | Only set if `true` |
| `array` (replicas) | Replicas are optional |
| `password`/`token` | Auth tokens are optional |

### 3. `/data` directories in the pod

Recap (more detail in [Environments](./environments.md#data-directories)):

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
| `image.repository` | `ghcr.io/zommehq/buntime` | Switch to `ghcr.io/zommehq/buntime` for the GitLab flow |
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

### Persistence

| Path | Default | Description |
|------|---------|-------------|
| `persistence.plugins.size` | `5Gi` | External plugins PVC size |
| `persistence.plugins.accessMode` | `ReadWriteMany` | Use `ReadWriteOnce` if `replicaCount=1` |
| `persistence.plugins.storageClass` | `""` | Empty = use cluster default |
| `persistence.apps.size` | `10Gi` | Apps PVC size |
| `persistence.apps.accessMode` | `ReadWriteMany` | Same as above |
| `persistence.apps.storageClass` | `""` | Same as above |

> **Standard k3s**: the `local-path-provisioner` does **not** support `ReadWriteMany`. For `replicaCount > 1`, use NFS, Longhorn, or another StorageClass with RWX.

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

The CLI/cpanel automates this flow via plugin-deployments — covered in [`../apps/plugin-deployments.md`](../apps/plugin-deployments.md).

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

When the chart is published with a higher `version` in `Chart.yaml`, Rancher shows **"Upgrade Available"**. The versioning flow is described in [Release flow](./release-flow.md).

## LibSQL StatefulSet (`charts/libsql`)

Separate chart for the LibSQL server (Turso). Runs as a StatefulSet with a PVC, exposes HTTP (`8080`) and gRPC (`5001`):

| Resource | Role |
|----------|------|
| StatefulSet | Pod with persistent volume (`/var/lib/sqld`) |
| Service | `http://libsql:8080` (HTTP) and `:5001` (gRPC) |
| ConfigMap | `SQLD_NODE: primary`, ports |
| Secret | `SQLD_AUTH_JWT_KEY` in production |

In dev (`SQLD_DISABLE_AUTH=true`) this is acceptable; in production, always use a JWT token — see [Security](./security.md).

Optional replicas (`SQLD_NODE: replica`, `SQLD_PRIMARY_URL`) fit in the same chart with `replicas: N` and a StorageClass that supports RWX if multiple nodes need to read/write the PVC.

## Troubleshooting

| Symptom | Where to look |
|---------|---------------|
| Pod in `Pending` | `kubectl describe pod` — usually PVC without a StorageClass |
| `ImagePullBackOff` | imagePullSecrets in the namespace + correct image.repository |
| Probe failing | `/api/health/live` and `/api/health/ready` must respond; `RUNTIME_API_PREFIX` changes these paths |
| `Plugin X requires Y` | Y must be enabled in the manifest (see [Environments](./environments.md#startup-validation)) |
| Missing cert | `kubectl get certificate -n zomme` + cert-manager logs |
| LibSQL unreachable | `kubectl exec deployment/buntime -- wget -qO- http://libsql:8080/health` |
