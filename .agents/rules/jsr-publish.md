# JSR Publishing

## @buntime/shared

The `@buntime/shared` package is published to [jsr.io](https://jsr.io/@buntime/shared) via GitHub Actions OIDC — **never publish manually from CLI**.

## Workflow

1. **Update** `packages/shared/jsr.json` and `packages/shared/package.json` (keep versions in sync)
2. **Commit and push** to `main`
3. **Trigger** the `JSR Publish` workflow via GitHub Actions (workflow_dispatch)
4. **Update** consumers: `bunx jsr add @buntime/shared` in each external plugin

## Trigger Command

```bash
gh workflow run jsr-publish.yml
# or with explicit version override:
gh workflow run jsr-publish.yml -f version=1.0.3
```

## Files

| File | Role |
|------|------|
| `packages/shared/jsr.json` | JSR metadata: name, version, exports, exclude |
| `packages/shared/package.json` | npm metadata (version must match jsr.json) |
| `.github/workflows/jsr-publish.yml` | Publish workflow (OIDC auth, workflow_dispatch) |

## Version Sync

`jsr.json:version` and `package.json:version` **must always match**. Update both together.

## Exports

When adding a new export to `@buntime/shared`:

1. Add to `package.json` exports (for workspace consumers)
2. Add to `jsr.json` exports (for JSR consumers)
3. Remove from `jsr.json` exclude if previously excluded
4. Bump version in both files
5. Follow the publish workflow above
