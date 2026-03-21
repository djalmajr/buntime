# Release Rules

## Publishing

- **NEVER** run `bump-version.ts`, `git tag`, or `git push` without explicit user permission
- Each new version **MUST** have its own release notes in `charts/release-notes.md` before publishing
- Always show the user what will be executed and wait for confirmation before any release operation

## Release Notes

- `charts/release-notes.md` is injected into `Chart.yaml` as the `catalog.cattle.io/release-notes` annotation
- Release notes should describe what changed **in that specific version**, not a cumulative changelog
- Keep notes relevant to chart consumers (runtime, plugins, helm config) — skip internal tooling details
