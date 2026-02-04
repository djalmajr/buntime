---
name: helm-deploy
summary: |
  - Helm charts in charts/buntime/, auto-generated from plugins/*/manifest.yaml
  - Run `bun scripts/generate-helm.ts` after manifest changes
  - Templates: deployment.yaml, configmap.yaml, pvc.yaml, ingress.yaml
  - Volumes /data/plugins and /data/apps are MANDATORY (no conditionals)
  - Plugin env vars MUST have defaults (no {{- if }} for core plugins)
  - Branch test/gitlab-ci: GitLab CI + registry.example.com + gitlab.example.com/zomme/charts
  - Branch main: GitHub Actions + GHCR + zommehq/charts
---

# Helm Charts & Kubernetes Deployment

## Directory Structure

```
charts/
├── buntime/
│   ├── Chart.yaml
│   ├── values.yaml              # AUTO-GENERATED from values.base.yaml
│   ├── values.base.yaml         # Edit this for runtime config
│   ├── configmap.base.yaml      # Edit this for runtime env vars
│   ├── questions.yml            # AUTO-GENERATED for Rancher UI
│   ├── questions.base.yaml      # Edit this for runtime questions
│   └── templates/
│       ├── configmap.yaml       # AUTO-GENERATED from configmap.base.yaml + manifests
│       ├── deployment.yaml      # Pod spec, volume mounts
│       ├── ingress.yaml         # Ingress (if host defined)
│       ├── pvc.yaml             # PVCs for /data/apps and /data/plugins
│       ├── route.yaml           # OpenShift Route (optional)
│       ├── secret.yaml          # Secrets (optional)
│       └── service.yaml         # Service
└── libsql/                      # LibSQL StatefulSet
```

## Generation Scripts

```bash
# Generate ALL Helm files (values.yaml, configmap.yaml, questions.yml)
bun scripts/generate-helm.ts

# Individual generators
bun scripts/generate-helm-values.ts
bun scripts/generate-helm-configmap.ts
bun scripts/generate-helm-questions.ts
```

**When to regenerate:** After modifying any `plugins/*/manifest.yaml` config section.

## Key Principles

### 1. Volumes are MANDATORY

`/data/plugins` and `/data/apps` PVCs must ALWAYS be mounted. No conditionals.

```yaml
# deployment.yaml - CORRECT (no conditionals)
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

### 2. Core Plugin Env Vars Need Defaults

All enabled plugins (database, gateway, deployments, proxy, keyval) must have env vars with defaults.

```yaml
# configmap.yaml - CORRECT (with default)
DATABASE_LIBSQL_URL: {{ .Values.plugins.database.libsqlUrl | default "http://libsql:8080" | quote }}
GATEWAY_CORS_ORIGIN: {{ .Values.plugins.gateway.cors.origin | default "*" | quote }}

# WRONG (conditional for core plugin)
{{- if .Values.plugins.database.libsqlUrl }}
DATABASE_LIBSQL_URL: {{ .Values.plugins.database.libsqlUrl | quote }}
{{- end }}
```

**Exceptions (conditionals OK):**
- `boolean` types: Only set if true
- `array` types: Replicas are optional
- `password` types: Auth tokens are optional

### 3. Data Directories

| Path | Type | Content |
|------|------|---------|
| `/data/.apps` | Image | Core apps (built into image) |
| `/data/.plugins` | Image | Core plugins (built into image) |
| `/data/apps` | PVC | External apps (user deployments) |
| `/data/plugins` | PVC | External plugins (e.g., plugin-auth-token) |

## CI/CD Pipelines

### test/gitlab-ci Branch (Development)

```yaml
# .gitlab-ci.yml
- Docker build -> ghcr.io/zommehq/buntime:latest
- Helm generate -> gitlab.example.com/zomme/charts
```

**Rancher points to:** `gitlab.example.com/zomme/charts`

### main Branch (Production)

```yaml
# .github/workflows/docker-publish.yml
- Docker build -> ghcr.io/zommehq/buntime:latest

# .github/workflows/helm-publish.yml  
- Helm generate -> zommehq/charts
```

## Deploy External Plugin to Kubernetes

External plugins (not in `plugins/`) must be copied to `/data/plugins` PVC:

```bash
# Get pod name
POD=$(kubectl -n zomme get pods -l app=buntime -o jsonpath='{.items[0].metadata.name}')

# Create plugin directory
kubectl -n zomme exec $POD -- mkdir -p /data/plugins/plugin-auth-token/dist

# Copy manifest and dist
kubectl -n zomme cp /path/to/plugin-auth-token/manifest.yaml $POD:/data/plugins/plugin-auth-token/
kubectl -n zomme cp /path/to/plugin-auth-token/dist/plugin.js $POD:/data/plugins/plugin-auth-token/dist/

# Restart to load plugin
kubectl -n zomme rollout restart deployment/buntime
```

## Important Helm Values

| Value | Description | Default |
|-------|-------------|---------|
| `buntime.apiPrefix` | API route prefix (e.g., `/_`) | `""` |
| `buntime.pluginDirs` | Plugin search paths | `/data/.plugins:/data/plugins` |
| `buntime.workerDirs` | Worker search paths | `/data/.apps:/data/apps` |
| `plugins.database.libsqlUrl` | LibSQL primary URL | `http://libsql:8080` |
| `plugins.gateway.shellDir` | Micro-frontend shell path | `""` |
| `plugins.gateway.shellExcludes` | Basenames to bypass shell | `cpanel` |
| `ingress.host` | Ingress hostname | `""` (disabled) |
| `ingress.tls.enabled` | Enable HTTPS | `false` |

## Common Commands

```bash
# Check current Helm values
helm -n zomme get values buntime

# Upgrade with new values
helm -n zomme upgrade buntime ./charts/buntime --reuse-values --set buntime.apiPrefix="/_"

# Check pod volumes
kubectl -n zomme exec deployment/buntime -- ls -la /data/

# View configmap
kubectl -n zomme get configmap buntime -o yaml

# Restart deployment
kubectl -n zomme rollout restart deployment/buntime
```
