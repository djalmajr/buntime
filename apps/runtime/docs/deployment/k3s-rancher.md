# k3s with Rancher Deployment

Deploying Buntime to a k3s cluster with Rancher, using Traefik as the ingress controller and cert-manager for TLS.

## Prerequisites

- k3s installed with Traefik
- cert-manager configured with ClusterIssuer
- Helm 3.x
- kubectl configured for the cluster

### Verify Cluster

```bash
# Verify nodes
kubectl get nodes

# Verify Traefik
kubectl get pods -n traefik

# Verify cert-manager
kubectl get pods -n cert-manager

# Verify ClusterIssuer
kubectl get clusterissuer
```

# Deploy via Helm CLI

## Build Image

There are two options for making the image available in the cluster:

### Option A: Import Directly to k3s (Development)

```bash
# Local build
docker build -t buntime:latest .

# Save image
docker save buntime:latest -o /tmp/buntime.tar

# Copy to k3s server
scp /tmp/buntime.tar user@k3s-server:/tmp/

# On the server, import to k3s containerd
ssh user@k3s-server 'sudo k3s ctr images import /tmp/buntime.tar'

# Verify
ssh user@k3s-server 'sudo k3s ctr images ls | grep buntime'
```

### Option B: Private Registry (Production)

```bash
# Login to registry (GitLab, Harbor, etc)
docker login registry.example.com

# Build and tag
docker build -t registry.example.com/buntime:latest .

# Push
docker push registry.example.com/buntime:latest
```

## Create Namespace

```bash
kubectl create namespace zomme
```

> [!NOTE]
> We recommend using a single `zomme` namespace for all services (buntime, libsql, etc). This simplifies inter-service communication (e.g., `http://libsql:8080` instead of `http://libsql.libsql:8080`).

## Create Values File

Create a `values-k3s.yaml` file with Traefik configurations:

```yaml
replicaCount: 1

image:
  repository: buntime  # or registry.example.com/buntime
  tag: latest
  pullPolicy: IfNotPresent  # Always if using registry

ingress:
  enabled: true
  className: traefik
  host: buntime.home
  path: "/"
  annotations:
    cert-manager.io/cluster-issuer: home-ca-issuer
  tls:
    enabled: true
    secretName: buntime-tls

buntime:
  port: 8000
  poolSize: 100
  workerDirs: "/data/apps"
  pluginDirs: "/data/plugins"
  logLevel: "info"

persistence:
  plugins:
    enabled: true
    size: 5Gi
  apps:
    enabled: true
    size: 10Gi
```

> [!NOTE]
> Each plugin has its own `manifest.yaml` in the plugins PVC. Plugins like metrics, deployments, and database are configured individually in their respective directories.

## Install with Helm

```bash
helm install buntime ./charts/buntime \
  --namespace zomme \
  -f values-k3s.yaml
```

## Verify Deployment

```bash
# View pods
kubectl get pods -n zomme

# View PVCs
kubectl get pvc -n zomme

# View ingress
kubectl get ingress -n zomme

# View TLS certificate
kubectl get certificate -n zomme

# View logs
kubectl logs -n zomme -l app.kubernetes.io/name=buntime -f
```

## Access

After deployment, access:

- **Dashboard**: https://buntime.home
- **Control Panel**: https://buntime.home/cpanel
- **Plugins API**: https://buntime.home/api/plugins
- **Health Check**: https://buntime.home/api/health

# Deploy via Rancher UI

## Add Helm Repository

1. Access https://rancher.home
2. In the sidebar, go to **Apps** > **Repositories**
3. Click **Create**
4. Fill in:
   - Name: `buntime-local`
   - Index URL: Chart URL or use Git URL
   - For Git: `https://github.com/zommehq/buntime.git` with Path `/charts`
5. Click **Create**

> [!TIP]
> For local development, you can use Rancher to add a local Git repository or host the chart on an HTTP server.

## Create Namespace

1. In the sidebar, go to **Cluster** > **Projects/Namespaces**
2. Click **Create Namespace**
3. Fill in:
   - Name: `zomme`
   - Description: Zomme Services (buntime, libsql, etc)
4. Click **Create**

## Install App

1. In the sidebar, go to **Apps** > **Charts**
2. Find the **buntime** chart
3. Click **Install**
4. Configure:

### Metadata

| Field | Value |
|-------|-------|
| Namespace | `zomme` |
| Name | `buntime` |

### Values YAML

Paste the contents of `values-k3s.yaml` or edit individual fields in the UI.

### Important for k3s

| Field | Value | Description |
|-------|-------|-------------|
| `ingress.enabled` | `true` | Enable ingress |
| `ingress.className` | `traefik` | Use Traefik (k3s default) |
| `ingress.host` | `buntime.home` | Service hostname |
| `ingress.tls.enabled` | `true` | Enable HTTPS |
| `ingress.annotations` | `cert-manager.io/cluster-issuer: home-ca-issuer` | Use cert-manager for TLS |

5. Click **Install**

## Monitor Deployment

1. In the sidebar, go to **Workloads** > **Deployments**
2. Select namespace `zomme`
3. Click on deployment `buntime`
4. Verify:
   - Pod status
   - Logs
   - Events

## Verify Created Resources

1. **Deployments**: Workloads > Deployments
2. **Services**: Service Discovery > Services
3. **Ingresses**: Service Discovery > Ingresses
4. **PVCs**: Storage > PersistentVolumeClaims
5. **ConfigMaps**: Storage > ConfigMaps
6. **Certificates**: (via kubectl) `kubectl get certificates -n zomme`

# Troubleshooting

## Pod Not Starting

```bash
# View pod events
kubectl describe pod -n zomme -l app.kubernetes.io/name=buntime

# Common causes:
# - Image not found: verify repository and tag
# - PVC pending: verify storage class available
# - Probe failure: check container logs
```

## Ingress Not Working

```bash
# Verify ingress
kubectl describe ingress -n zomme buntime

# Verify certificate
kubectl describe certificate -n zomme buntime-tls

# Verify Traefik logs
kubectl logs -n traefik -l app.kubernetes.io/name=traefik
```

## Certificate Not Generated

```bash
# Verify CertificateRequest
kubectl get certificaterequest -n zomme

# Verify ClusterIssuer
kubectl describe clusterissuer home-ca-issuer

# Verify cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager
```

## libSQL Connection Failure

```bash
# Verify libSQL is running (same namespace)
kubectl get pods -n zomme -l app.kubernetes.io/name=libsql

# Test connectivity from buntime pod
kubectl exec -n zomme -it deployment/buntime -- \
  wget -qO- http://libsql:8080/health
```

# Upgrade

## Via Helm CLI

```bash
# Rebuild image (if needed)
docker build -t buntime:latest .
# Re-import to k3s or push to registry

# Upgrade
helm upgrade buntime ./charts/buntime \
  --namespace zomme \
  -f values-k3s.yaml

# Force pod restart (pull new image)
kubectl rollout restart deployment -n zomme buntime
```

## Via Rancher UI

1. Go to **Apps** > **Installed Apps**
2. Find `buntime`
3. Click **Upgrade**
4. Modify values if needed
5. Click **Upgrade**

# Uninstall

## Via Helm CLI

```bash
helm uninstall buntime --namespace zomme

# Optional: remove PVCs (persistent data)
kubectl delete pvc -n zomme -l app.kubernetes.io/name=buntime

# Optional: remove namespace (caution: removes all services!)
kubectl delete namespace zomme
```

## Via Rancher UI

1. Go to **Apps** > **Installed Apps**
2. Find `buntime`
3. Click **Delete**
4. Confirm removal

> [!WARNING]
> Uninstalling via Rancher doesn't automatically remove PVCs. Remove them manually if needed.

# Advanced Configuration

## Multiple Replicas

```yaml
replicaCount: 3

# PVC must be ReadWriteMany for multiple replicas
persistence:
  plugins:
    enabled: true
    size: 5Gi
    accessMode: ReadWriteMany  # Requires storage class that supports RWX
  apps:
    enabled: true
    size: 10Gi
    accessMode: ReadWriteMany
```

> [!NOTE]
> The default k3s local-path-provisioner doesn't support ReadWriteMany. Use NFS or another storage class.

## Resource Limits

```yaml
# Add to deployment via values or overlay
resources:
  requests:
    cpu: 500m
    memory: 256Mi
  limits:
    cpu: "2"
    memory: 1Gi
```

## Custom Environment Variables

```yaml
buntime:
  port: 8000
  poolSize: 200
  logLevel: "debug"
  # Additional variables via ConfigMap
```

# Quick Reference

| Action | Command |
|--------|---------|
| Install | `helm install buntime ./charts/buntime -n zomme -f values-k3s.yaml` |
| Upgrade | `helm upgrade buntime ./charts/buntime -n zomme -f values-k3s.yaml` |
| Uninstall | `helm uninstall buntime -n zomme` |
| View status | `helm status buntime -n zomme` |
| View pods | `kubectl get pods -n zomme` |
| View logs | `kubectl logs -n zomme -l app.kubernetes.io/name=buntime -f` |
| Restart pods | `kubectl rollout restart deployment -n zomme buntime` |
| Shell into pod | `kubectl exec -n zomme -it deployment/buntime -- sh` |
