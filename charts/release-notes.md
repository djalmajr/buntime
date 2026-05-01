## What's New

### Runtime
- Added file-backed API keys for CLI/TUI and automation flows.
- Added support for master-key bootstrapping through Kubernetes secrets.
- Improved plugin and app upload workflows for Rancher deployments that use a configurable runtime API base such as `/_/api`.
- Preserved worker resilience improvements from the previous runtime update: sliding TTL, notification-only `idleTimeout`, and `maxRequests` as the recycle safety net.

### CLI
- Added GitHub Actions builds for downloadable CLI artifacts on Linux, Windows, and macOS.
- Added local GitLab CLI artifact builds for the Rancher lab workflow.
- Documented CLI/TUI usage, API keys, package upload formats, API-base discovery, and artifact download locations.

### Deployment
- Documented the local GitLab registry and Rancher chart catalog flow.
- Documented GitHub Actions release infrastructure for Docker, Helm, JSR, and CLI artifacts.

### Performance
- Added Rancher pod and worker route performance reports, including k6 commands, measured latency, pod CPU/memory impact, and follow-up checks.
