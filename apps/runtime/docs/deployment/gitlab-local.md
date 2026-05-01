# Local GitLab Pipeline

This repository includes a GitLab CI pipeline for the local lab at `gitlab.example.com` and deploys manually to the Rancher/k3s cluster reachable through `rancher.home`.

## Pipeline Jobs

| Job | Stage | Purpose |
| --- | --- | --- |
| `helm:generate` | `prepare` | Generates `charts/values.yaml`, `charts/templates/configmap.yaml`, and `charts/questions.yml`. |
| `runtime:test` | `validate` | Runs runtime type checks and unit tests. |
| `helm:template` | `validate` | Runs `helm lint` and `helm template` against the generated chart. |
| `runtime:performance` | `performance` | Runs the short direct-mode benchmark gate and stores `apps/runtime/perf-results.json`. |
| `container:image` | `package` | Builds and pushes the image to the GitLab registry. Runs on tags/default branch or manually. |
| `deploy:rancher` | `deploy` | Manual Helm deploy to the Rancher/k3s cluster. |
| `helm:publish-local` | `publish` | Manual chart publication to `gitlab.example.com/zomme/charts`. |

## GitLab Runner

The pipeline assumes a Docker executor runner tagged `docker`.

Required runner capabilities:

- Pull `oven/bun:1.3.13`, `alpine/helm:3.14.4`, and `docker:24`.
- Run Docker-in-Docker for `container:image`.
- Reach the local GitLab registry and Rancher/k3s API.

For the lab registry, the Docker-in-Docker service is configured with:

```yaml
--insecure-registry=registry.example.com
```

If the registry is exposed as `gitlab.example.com:5050` instead, update `.gitlab-ci.yml` and the GitLab registry external URL to use that host consistently.

## CI/CD Variables

Configure these in GitLab under **Settings > CI/CD > Variables**:

| Variable | Required | Description |
| --- | --- | --- |
| `KUBECONFIG_B64` | deploy only | Base64-encoded kubeconfig exported from Rancher. |
| `CHARTS_TOKEN` | publish only | Token with push access to `gitlab.example.com/zomme/charts`. |
| `BUNTIME_IMAGE_REPOSITORY` | optional | Overrides the deploy image repository. Defaults to `$CI_REGISTRY_IMAGE`. |
| `BUNTIME_IMAGE_TAG` | optional | Overrides the deploy image tag. Defaults to `$CI_COMMIT_SHORT_SHA`. |
| `KUBE_NAMESPACE` | optional | Kubernetes namespace. Defaults to `zomme`. |
| `BUNTIME_RELEASE_NAME` | optional | Helm release name. Defaults to `buntime`. |

Encode the kubeconfig:

```bash
base64 -i kubeconfig.yaml
```

## Local DNS

The local lab should resolve both GitLab and Rancher names through `dnsmasq`:

```bash
dig @127.0.0.1 gitlab.example.com +short
dig @127.0.0.1 rancher.home +short
dig @127.0.0.1 registry.example.com +short
```

In the current lab, `.home` names point to the fixed VM IP, while `dnsmasq` listens on the local machine address `192.168.0.5`.

## Deploy Flow

1. Push the branch to the local GitLab project.
2. Let `runtime:test`, `helm:template`, and `runtime:performance` run.
3. Run `container:image` manually when testing a branch image, or rely on automatic runs for tags/default branch.
4. Run `deploy:rancher` manually after the image exists in the local registry.
5. Verify through Rancher or CLI:

```bash
helm status buntime -n zomme
kubectl get pods -n zomme -l app.kubernetes.io/name=buntime
kubectl logs -n zomme -l app.kubernetes.io/name=buntime --tail=100
```

## Rancher Registry Pulls

If the GitLab registry is private, create an image pull secret in the target namespace and set it in chart values:

```bash
kubectl create secret docker-registry gitlab-registry \
  --namespace zomme \
  --docker-server=registry.example.com \
  --docker-username=<user> \
  --docker-password=<token>
```

```yaml
imagePullSecrets:
  - name: gitlab-registry
```

