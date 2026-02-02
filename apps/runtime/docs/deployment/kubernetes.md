# Kubernetes Deployment

Buntime provides a Helm chart for deployment on Kubernetes and OpenShift/OKD.

## Prerequisites

- Kubernetes 1.19+ or OpenShift/OKD 4.x
- Helm 3.x
- `kubectl` or `oc` CLI

## Quick Start

```bash
# Clone the repository
git clone https://github.com/zommehq/buntime.git
cd buntime

# Install with Helm
helm install buntime charts/buntime
```

# Installation Methods

## NodePort (Default)

Ideal for local testing and development clusters:

```bash
helm install buntime charts/buntime

# Get the access URL
export NODE_PORT=$(kubectl get svc buntime -o jsonpath='{.spec.ports[0].nodePort}')
export NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[0].address}')
echo http://$NODE_IP:$NODE_PORT
```

## Ingress (Kubernetes)

For production with an Ingress controller:

```bash
helm install buntime charts/buntime \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.host=buntime.example.com
```

With TLS:

```bash
helm install buntime charts/buntime \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.host=buntime.example.com \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=buntime-tls
```

With path prefix (rewrite enabled automatically):

```bash
helm install buntime charts/buntime \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.host=example.com \
  --set ingress.path=/b
```

With wildcard host and existing TLS secret:

```bash
helm install buntime charts/buntime \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set 'ingress.host=*.example.com' \
  --set ingress.path=/b \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=cert-example
```

> [!NOTE]
> When using `ingress.path` with a value other than `/`, the chart automatically adds nginx rewrite annotations to remove the prefix before forwarding to the backend.

## Route (OpenShift/OKD)

For OpenShift/OKD environments:

```bash
helm install buntime charts/buntime \
  --set route.enabled=true \
  --set route.host=buntime.apps.mycluster.com
```

# Configuration

## values.yaml

```yaml
replicaCount: 1

image:
  repository: ghcr.io/zommehq/buntime
  tag: latest
  pullPolicy: Always

nameOverride: ""
fullnameOverride: ""

service:
  type: NodePort
  port: 8000

# Kubernetes Ingress
ingress:
  enabled: false
  className: ""  # nginx, traefik, alb, etc
  host: ""
  path: "/"  # Use "/b" for path-based routing (auto-rewrite)
  annotations: {}
  tls:
    enabled: false
    secretName: ""  # auto-generated if empty

# OpenShift/OKD Route
route:
  enabled: false
  host: ""
  tls:
    enabled: true
    termination: edge  # edge, passthrough, reencrypt

# Buntime configuration
buntime:
  port: 8000
  poolSize: 100
  workerDirs: "/data/apps"
  pluginDirs: "/data/plugins"
  logLevel: "info"

# Persistent storage
persistence:
  plugins:
    enabled: true
    size: 5Gi
    accessMode: ReadWriteOnce
    storageClass: ""  # Use default if empty
  apps:
    enabled: true
    size: 10Gi
    accessMode: ReadWriteOnce
    storageClass: ""  # Use default if empty
```

## Common Configurations

### Basic Deployment

```bash
helm install buntime charts/buntime \
  --set replicaCount=2 \
  --set buntime.poolSize=200
```

### Disable Persistence

```bash
helm install buntime charts/buntime \
  --set persistence.plugins.enabled=false \
  --set persistence.apps.enabled=false
```

### Custom Image

```bash
helm install buntime charts/buntime \
  --set image.repository=myregistry.io/buntime \
  --set image.tag=v1.2.3
```

# Architecture

## Created Resources

| Resource | Description |
|----------|-------------|
| Deployment | Buntime pods with health probes |
| Service | ClusterIP/NodePort for internal access |
| ConfigMap | Environment variables (PORT, RUNTIME_POOL_SIZE, RUNTIME_WORKER_DIRS, RUNTIME_PLUGIN_DIRS) |
| PersistentVolumeClaim (apps) | Storage for worker applications (10Gi default) |
| PersistentVolumeClaim (plugins) | Storage for external plugins (5Gi default) |
| Ingress (optional) | External HTTP/HTTPS access |
| Route (optional) | OpenShift Route for external access |

## Pod Configuration

The deployment creates pods with:

- **Health Probes**: Liveness (`/api/health/live`) and readiness (`/api/health/ready`) checks
- **Env Vars**: Loaded from ConfigMap via `envFrom`
- **PVC Mounts**: Apps and plugins on persistent volumes

# Operations

## View Logs

```bash
kubectl logs -f deployment/buntime
```

## Verify Configuration

```bash
# View environment variables ConfigMap
kubectl get configmap buntime -o yaml
```

## Scale

```bash
kubectl scale deployment buntime --replicas=3
```

## Upgrade

```bash
helm upgrade buntime charts/buntime \
  --set image.tag=v2.0.0
```

## Uninstall

```bash
helm uninstall buntime
```

# LibSQL Deployment

If using database plugins, deploy LibSQL alongside Buntime:

```yaml
# libsql-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: libsql
spec:
  replicas: 1
  selector:
    matchLabels:
      app: libsql
  template:
    metadata:
      labels:
        app: libsql
    spec:
      containers:
        - name: libsql
          image: ghcr.io/tursodatabase/libsql-server:latest
          ports:
            - containerPort: 8080
          env:
            - name: SQLD_NODE
              value: primary
            - name: SQLD_DISABLE_AUTH
              value: "true"
          volumeMounts:
            - name: data
              mountPath: /var/lib/sqld
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: libsql
spec:
  selector:
    app: libsql
  ports:
    - port: 8080
      targetPort: 8080
```

Then install Buntime. Each plugin has its own `manifest.yaml` in the plugins PVC:

```bash
helm install buntime charts/buntime
```

> [!NOTE]
> The runtime is configured via environment variables (PORT, RUNTIME_WORKER_DIRS, RUNTIME_POOL_SIZE, etc). Each plugin has its own `manifest.yaml` in the plugins PVC (database, keyval, etc).

# Troubleshooting

## Pod Not Starting

Check events:

```bash
kubectl describe pod -l app=buntime
```

Common issues:

- Image pull error: Verify the image repository and credentials
- Probe failures: Check if the `/api/plugins` endpoint works
- Configuration error: Check ConfigMaps for valid configuration

## Plugin Loading Failures

Check logs for plugin errors:

```bash
kubectl logs -l app=buntime | grep -i plugin
```

## Connection Refused

Verify the service is running:

```bash
kubectl get svc buntime
kubectl get endpoints buntime
```

# Production Recommendations

## Resource Limits

Add resource limits in production:

```yaml
# values-production.yaml
replicaCount: 3

buntime:
  poolSize: 500

# Add to deployment manually or extend the chart
resources:
  limits:
    cpu: "2"
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 256Mi
```

## High Availability

```bash
helm install buntime charts/buntime \
  --set replicaCount=3 \
  --set buntime.poolSize=200
```

## Monitoring

Configure the metrics plugin and collect with Prometheus.

> [!NOTE]
> The `@buntime/plugin-metrics` plugin needs `enabled: true` in its `manifest.yaml` to expose metrics.

Prometheus ServiceMonitor (if using Prometheus Operator):

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: buntime
spec:
  selector:
    matchLabels:
      app: buntime
  endpoints:
    - port: http
      path: /api/metrics/prometheus
      interval: 30s
```
