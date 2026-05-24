---
title: "Runbook — GitLab CI worker packages (build → registry → upload)"
audience: ops
sources:
  - apps/runtime/src/libs/registry/packager.ts
  - apps/runtime/src/routes/workers.ts
  - deploy/install-home-workload.sh
updated: 2026-05-24
tags: [runbook, gitlab, ci, runner, worker, package, registry, tgz, rancher, deploy]
status: stable
---

# Runbook — GitLab CI worker packages

How to build a Buntime **worker package** in GitLab CI, publish it to the GitLab
**Generic Package Registry** (indefinite retention), and upload it to Buntime.
Distilled from setting up the pipeline on the **local GitLab** (`gitlab.example.com`,
chart `gitlab` 18.11.3) against the home-workload k3s cluster.

> This complements [`runbook-apps-gateway-proxy.md`](./runbook-apps-gateway-proxy.md)
> (which deploys workers/app-shell by hand). Here the build + packaging are
> reproducible in CI and the artifact lives in GitLab; the **upload to Buntime is
> manual** by design.

## Worker upload contract (the archive)

`POST /_/api/workers/upload` (multipart `file=@…`). From `packager.ts`
(`detectArchiveFormat`):

| Format            | Extracted with                          |
|-------------------|-----------------------------------------|
| `.tgz` / `.tar.gz`| `tar -xzf --strip-components=1`          |
| `.zip`            | `unzip -o`                              |

- **Only those three.** No plain `.tar`, no `.7z` (would need `p7zip` in the
  image for no real gain — `.tgz` already covers the tar case with compression).
- `--strip-components=1` means the archive must have a **single top-level dir**
  (npm-pack style). Build it as `tar -czf pkg.tgz package` where `package/`
  contains `dist/`, `index.ts`, `manifest.yaml` (and optionally `package.json`).
  After strip, those land at the worker install root.
- Install path is **`<workerDir>/<name>/<version>/`**, where `name`/`version`
  come from `manifest.yaml` or `package.json` (`readPackageInfo`). **Gotcha:** if
  `package.json` is `@scope/app@1.0.0-rc.0`, the worker installs at
  `@scope/app/1.0.0-rc.0/`, **not** `example-spa/1.0.0/`. If a
  gateway `shellDir` points at a specific path, align the manifest `name`/version
  (or the shellDir) when switching from `kubectl cp` to API upload.

## The `.gitlab-ci.yml` (worker package job)

```yaml
variables:
  PKG_NAME: "example-spa"
  MANIFEST: "manifest.home-workload.yaml"   # per-env manifest selects the target

cache:
  key: { files: [bun.lock] }
  paths: [node_modules/]

package:worker:
  stage: .post                 # avoids clashing with an included template's stages
  image: oven/bun:1.3.12
  script:
    - |
      set -euo pipefail
      bun install --frozen-lockfile
      NODE_ENV=production bun scripts/build.ts
      rm -rf package && mkdir -p package
      cp -r dist package/dist
      cp index.ts package/index.ts
      cp "${MANIFEST}" package/manifest.yaml
      cp package.json package/package.json
      tar -czf "${PKG_NAME}.tgz" package          # top dir "package/" => strip-components=1
      export PKG_URL="${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/${PKG_NAME}/${CI_COMMIT_SHORT_SHA}/${PKG_NAME}.tgz"
      export PKG_FILE="${PKG_NAME}.tgz"
      # oven/bun has no curl — upload with bun's fetch. For a self-signed GitLab,
      # prefix with NODE_TLS_REJECT_UNAUTHORIZED=0 (local/trusted instances only).
      bun -e 'const r=await fetch(process.env.PKG_URL,{method:"PUT",headers:{"JOB-TOKEN":process.env.CI_JOB_TOKEN},body:Bun.file(process.env.PKG_FILE)}); console.log("publish",r.status); if(!r.ok){console.error(await r.text());process.exit(1)}'
```

Durable store = **Generic Package Registry** (no expiry). Job `artifacts:` were
intentionally dropped — see the 405 gotcha below.

## GitLab Runner on k3s — setup + gotchas

There was **no runner** initially (pipelines stay `pending`). Install one:

```sh
# 1. instance runner auth token (GitLab 16+ flow — NOT the legacy registration token)
curl --request POST --header "PRIVATE-TOKEN: <admin-pat>" \
  "$GL/api/v4/user/runners" --data "runner_type=instance_type" \
  --data "run_untagged=true" --data "description=k8s-runner"   # => { token: glrt-… }

# 2. helm install (chart version matches the GitLab app version)
helm install gitlab-runner gitlab/gitlab-runner --version 0.88.3 -n gitlab \
  -f runner-values.yaml --set-string runnerToken="glrt-…"
```

`runner-values.yaml`:

```yaml
gitlabUrl: http://gitlab-webservice-default.gitlab.svc.cluster.local:8181/
rbac: { create: true }
serviceAccount: { create: true }
runners:
  config: |
    [[runners]]
      executor = "kubernetes"
      clone_url = "http://gitlab-webservice-default.gitlab.svc.cluster.local:8181"
      [runners.kubernetes]
        namespace = "gitlab"
        image = "alpine:3.20"
        helper_image = "registry.gitlab.com/gitlab-org/gitlab-runner/gitlab-runner-helper:arm64-v18.11.3"
```

Gotchas hit, in order (each was one failed pipeline):

1. **YAML `mapping values` error** — `script` lines containing `: ` (e.g.
   `printf 'entrypoint: index.ts'`) break the parser. Use a literal block
   (`- |`) for the whole script.
2. **arm64 helper image** — the k3s nodes (Mac/multipass) are **arm64**, but the
   runner defaulted to `gitlab-runner-helper:x86_64-…` → "no match for platform".
   Set `helper_image` to the `arm64-…` tag.
3. **Clone TLS** — cloning `https://gitlab.example.com` failed cert verification
   (self-signed). For an in-cluster runner, set `clone_url` to the in-cluster
   **HTTP** service so clones skip the external cert.
4. **No `curl` in `oven/bun`** — upload with `bun`'s `fetch` instead.
5. **Upload TLS** — `CI_API_V4_URL` is the external `https://gitlab.example.com`
   (self-signed) → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. `NODE_TLS_REJECT_UNAUTHORIZED=0`
   for the upload only (local instance). Drop it on a trusted-CA GitLab.
6. **`artifacts:` upload → 405** — uploading job artifacts to the in-cluster
   service URL returns `405 Method Not Allowed` (doesn't route through Workhorse
   the way the package registry / ingress does). The Generic Package Registry
   already gives indefinite retention, so the `artifacts:` block was removed.
7. **Protected `main`** — can't force-push; push to a feature branch and the
   pipeline runs there.

## Manual upload to Buntime

```sh
# $GITLAB_PAT: a GitLab PAT with `api` scope; $BUNTIME_KEY: a runtime API key.
curl --header "PRIVATE-TOKEN: $GITLAB_PAT" \
  "$GITLAB_URL/api/v4/projects/<id>/packages/generic/example-spa/<SHA>/example-spa.tgz" \
  -o example-spa.tgz
curl --header "X-API-Key: $BUNTIME_KEY" -F "file=@example-spa.tgz" \
  "$BUNTIME_URL/_/api/workers/upload"
```

## Credentials

Provide these out of band (env vars / a secrets store / files outside the repo) —
**do not commit token values or their on-disk locations**:

- A GitLab **API PAT** (`api`, `write_repository`) for creating projects, pushing,
  and reading the package registry. On a self-hosted instance an admin PAT can be
  minted without a password via the toolbox Rails console
  (`gitlab-rails runner "User.find_by_username('root').personal_access_tokens.create!(...)"`).
- An **instance runner** auth token (`glrt-…`) for the GitLab Runner.
- The runtime **API key** for the Buntime worker upload.
- Note: a GitLab **registry/deploy** token (for `docker login`) is **not** an API
  token — it returns 401 on `/api/v4`. Keep them separate.
