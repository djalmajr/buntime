# Local GitLab Pipeline

This repository includes a minimal GitLab CI pipeline for the local lab at `gitlab.example.com`. Its only responsibility is building the Docker image and pushing it to the local GitLab registry so Rancher can deploy that image.

## Pipeline Jobs

| Job | Stage | Purpose |
| --- | --- | --- |
| `image:build` | `image` | Builds and pushes the image to the GitLab registry. |

The job publishes these tags:

| Tag | Purpose |
| --- | --- |
| `$CI_COMMIT_SHORT_SHA` | Immutable image for an exact commit. |
| `$CI_COMMIT_REF_SLUG` | Stable branch/tag-friendly image for Rancher tests. |
| `latest` | Convenience tag for local lab deploys. |
| `$CI_COMMIT_TAG` | Release tag, only when the pipeline runs for a Git tag. |

## GitLab Runner

The pipeline assumes a Docker executor runner tagged `docker`.

Required runner capabilities:

- Pull `docker:24`.
- Run Docker-in-Docker for `image:build`.
- Reach the local GitLab registry.

For the lab registry, the Docker-in-Docker service is configured with:

```yaml
--insecure-registry=registry.example.com
```

If the registry is exposed as `gitlab.example.com:5050` instead, update `.gitlab-ci.yml` and the GitLab registry external URL to use that host consistently.

## CI/CD Variables

No project-specific CI/CD variable is required for the image build. The job uses GitLab-provided registry variables:

| Variable | Source | Description |
| --- | --- | --- |
| `CI_REGISTRY` | GitLab | Registry host. |
| `CI_REGISTRY_IMAGE` | GitLab | Project image repository. |
| `CI_REGISTRY_USER` | GitLab | Registry username for the job token. |
| `CI_REGISTRY_PASSWORD` | GitLab | Registry password for the job token. |

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
2. Wait for `image:build` to push the image.
3. In Rancher, use one of the pushed tags:

```yaml
image:
  repository: ghcr.io/zommehq/buntime
  tag: runtime-performance-resilience
  pullPolicy: Always
```

4. Verify through Rancher or CLI:

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
