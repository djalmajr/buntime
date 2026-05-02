#!/usr/bin/env bash
# wiki-consider.sh - Codex PostToolUse hook
# Remind agents to evaluate whether sensitive project edits require a wiki
# update. It does not auto-ingest; that decision is semantic.

set -euo pipefail

INPUT="$(cat)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

TOOL="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')"

case "$TOOL" in
  apply_patch|Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

payload_files() {
  printf '%s' "$INPUT" |
    jq -r '
      [
        .tool_input.file_path?,
        .tool_input.notebook_path?,
        .tool_response.filePath?,
        (.tool_input.edits? // [] | .[]? | .file_path?),
        (
          (.tool_input.command? // "") |
          split("\n")[] |
          capture("^\\*\\*\\* (?:Add|Update|Delete) File: (?<path>.+)$")? |
          .path
        )
      ] | .[]? // empty
    '
}

repo_relative_file() {
  local file="$1"

  case "$file" in
    "$ROOT"/*) file="${file#"$ROOT"/}" ;;
    /*) return 1 ;;
    ../*) return 1 ;;
  esac

  case "$file" in
    .git/*|node_modules/*|dist/*|tmp/*|wiki/*) return 1 ;;
    *) printf '%s\n' "$file" ;;
  esac
}

sensitive_reason() {
  case "$1" in
    .mcp.json|.codex/config.toml|.codex/hooks.json|.codex/hooks/*|.claude/settings.json|.claude/hooks/*)
      printf 'agent/QMD tooling changed -> wiki/QMD.md and wiki/log.md' ;;
    CLAUDE.md|AGENTS.md)
      printf 'agent execution policy changed -> keep root rules canonical and update wiki references if behavior changed' ;;
    package.json|bun.lock|packages/*/package.json)
      printf 'package/dependency surface changed -> wiki/apps/packages.md or wiki/ops/local-dev.md if load-bearing' ;;
    apps/*/package.json|plugins/*/package.json)
      printf 'app/plugin package surface changed -> wiki/apps/<component>.md if public behavior changed' ;;
    apps/runtime/src/routes/*|apps/runtime/src/server/*|apps/runtime/src/plugins/*|apps/runtime/src/worker*|apps/runtime/src/pool/*)
      printf 'runtime API or internals changed -> wiki/apps/runtime.md or wiki/apps/runtime-api-reference.md' ;;
    plugins/*/manifest.yaml|plugins/*/manifest.yml|plugins/*/plugin.ts|plugins/*/server/*|plugins/*/server/**/*|plugins/*/client/*|plugins/*/client/**/*)
      printf 'plugin contract or behavior changed -> wiki/apps/plugin-<name>.md' ;;
    packages/shared/src/errors*|packages/shared/src/logger/*|packages/shared/src/logger/**/*|packages/shared/src/utils/*)
      printf '@buntime/shared contract changed -> wiki/apps/packages.md' ;;
    packages/database/src/*|packages/keyval/src/*|packages/*/src/**/*schema*|plugins/*/server/**/*schema*)
      printf 'schema/store/data contract changed -> wiki/data/ or the relevant wiki/apps page' ;;
    charts/*|charts/**/*|.github/workflows/*)
      printf 'deploy/release/CI surface changed -> wiki/ops/helm-charts.md, wiki/ops/release-flow.md, or wiki/ops/jsr-publish.md' ;;
    scripts/*|scripts/**/*)
      printf 'automation workflow changed -> wiki/ops/ or wiki/agents/ if reusable by agents' ;;
    *) return 1 ;;
  esac
}

sensitive_lines=""

while IFS= read -r file; do
  [ -n "$file" ] || continue
  rel="$(repo_relative_file "$file" || true)"
  [ -n "$rel" ] || continue
  reason="$(sensitive_reason "$rel" || true)"
  [ -n "$reason" ] || continue
  sensitive_lines="${sensitive_lines}
- ${rel} (${reason})"
done < <(
  {
    payload_files
    git -C "$ROOT" diff --name-only HEAD -- 2>/dev/null || true
    git -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u
)

if [ -z "$sensitive_lines" ]; then
  exit 0
fi

STAMP_FILE="${TMPDIR:-/tmp}/buntime-wiki-consider.stamp"
NOW="$(date +%s)"
LAST="$(cat "$STAMP_FILE" 2>/dev/null || echo 0)"

if [ $((NOW - LAST)) -lt 30 ]; then
  exit 0
fi

echo "$NOW" > "$STAMP_FILE"

cat >&2 <<EOF
Wiki ingest consideration: sensitive Buntime paths changed.${sensitive_lines}

Before the final response, decide whether this creates or changes a canonical rule, contract, schema, gotcha, dependency quirk, reusable pattern, or operational constraint.
If yes, update wiki/, add a top entry to wiki/log.md, and run:
  qmd --index buntime update && qmd --index buntime embed
EOF

exit 0
