---
name: buntime-provision-app
description: >-
  Provision a Buntime app's full footprint onto a runtime from its manifest
  `deploy:` spec — required plugins, proxy redirects, the worker, and the
  app-shell role — in one deterministic, idempotent pass. Use when installing or
  re-provisioning a Buntime app (e.g. front-manager) on an environment, after a
  teardown, or when an app does not work because a dependency (plugin/redirect/
  shell) is missing.
---

# Buntime: provision an app from its manifest deploy spec

A Buntime app rarely runs alone: it needs its **worker** uploaded, the **plugins**
it depends on loaded, the **proxy redirects** that forward its `/api`-style paths
to a backend, and (for an app-shell) the runtime pointed at it. This skill applies
all of that from a single declarative source: the app's worker `manifest.yaml`
under a `deploy:` block.

The block is parsed by `@buntime/shared/utils/deploy-spec` (`parseDeploySpec`).
The runtime itself **ignores** unknown manifest keys, so `deploy:` is
non-disruptive — it exists only for provisioning tooling.

## The deploy spec

```yaml
# in the app's manifest.yaml (or a per-env overlay like manifest.<cluster>.yaml)
deploy:
  shell: default          # "default" (global shell) | "none" | { perTenant: host }
  plugins:                # uploaded + reloaded before the worker
    - name: "@scope/plugin-x"
      source: "../../some-repo/plugin-x"   # local path (relative to this manifest)
    - name: "@scope/plugin-y"
      source: "git+https://github.com/org/repo#subdir"   # or a git ref
  redirects:              # idempotent upsert into plugin-proxy (keyed by pattern)
    - name: "app API"
      pattern: "^/api(/.*)?$"
      target: "${BACKEND_URL}"   # ${VAR} interpolated from manifest env + process env + --env
      rewrite: "/api$1"
      changeOrigin: true
      secure: true
  requiresEnv:            # env the worker needs at runtime (documentation/preflight)
    - AUTH_CONFIG
```

`source` is resolved relative to the manifest's directory (local path) or cloned
(`git+<url>#<subdir>`). `${VAR}` in redirect fields is interpolated from, in order
of precedence: the manifest's own `env:` block, `process.env`, then `--env` flags.

## Run it

The provisioner is a deterministic script — `apps/mcp/scripts/provision.ts`
(`@buntime/mcp` package script `provision`). It talks to the runtime via the same
management REST API the MCP tools use.

```bash
# Point at the runtime (same env the MCP server uses)
export BUNTIME_URL=...          # e.g. http://localhost:8800 (k8s lab port-forward) or https://buntime.<domain>
export BUNTIME_API_KEY=...      # root key or a btk_* key

bun run --filter @buntime/mcp provision \
  --manifest /path/to/app/manifest.<env>.yaml \
  [--env BACKEND_URL=https://backend.example.com] \
  [--skip-build]
```

What it does, in order (each step idempotent and re-runnable):

1. **Plugins** — for each `plugins[]`: resolve `source` → build if `dist/` is
   missing → pack → `upload_plugin`; then a single `reload_plugins`.
2. **Redirects** — `list_redirects`, then for each `redirects[]` upsert by
   `pattern` (`set_redirect` with the existing id when matched, else create).
3. **Worker** — build the app (unless `--skip-build`), pack it using **the chosen
   manifest as `manifest.yaml`** (so a per-env overlay ships correctly), and
   `upload_worker` (upsert in place).
4. **App-shell** — `shell: default` → `set_shell_dir(installedAt)`;
   `{ perTenant: host }` → `set_shell_route(host, installedAt)`; `none` → skip.
5. **Verify** — `health` check.

## Prerequisites

- `BUNTIME_URL` + `BUNTIME_API_KEY` set (an API key with sufficient role/namespaces;
  authorization is enforced server-side).
- For a **k8s lab**, the NodePort is randomly reassigned per redeploy — open the
  dedicated port-forward first and point `BUNTIME_URL` at the stable localhost port:
  `bun run --filter @buntime/mcp port-forward` (see `apps/mcp/README.md`).
- For local-path plugin `source`s, the referenced repos must be checked out at the
  expected relative location.

## Verify after provisioning

- `curl -s "$BUNTIME_URL/health"` → healthy.
- `list_loaded_plugins` includes every `plugins[].name`.
- `list_redirects` includes every `redirects[].pattern`.
- For a shell: open the app host in a browser; for `perTenant`, send the tenant
  `Host` header (Chrome resolves `*.localhost` to loopback for local tests).

## Notes

- **Idempotent**: safe to re-run. Re-running upserts the worker/redirects in place;
  bump the worker `version` in the manifest for an atomic version switch.
- The provisioner uses the `RuntimeClient` directly (including proxy redirects), so
  it works even if the long-running MCP server in the session predates a tool.
- Reference: deploy spec `packages/shared/src/utils/deploy-spec.ts`; client
  `apps/mcp/src/client.ts`; runtime ops in ai-memory `djalmajr/infra` runbooks.
