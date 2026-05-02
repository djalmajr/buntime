#!/usr/bin/env bash
# wiki-suggest-ingest.sh - Claude Code Stop hook
# Soft reminder to evaluate whether sensitive source changes need wiki ingest.

set -euo pipefail

INPUT="$(cat)"
SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty')"
STOP_HOOK_ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')"

if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

STATE_FILE="${TMPDIR:-/tmp}/buntime-wiki-suggest-${SESSION_ID:-unknown}.fired"
if [ -f "$STATE_FILE" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || exit 0

CHANGED="$(
  {
    git diff --name-only HEAD 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u
)"

if [ -z "$CHANGED" ]; then
  exit 0
fi

declare -a SENSITIVE_PATTERNS=(
  '^\.mcp\.json$'
  '^\.codex/(config\.toml|hooks\.json|hooks/)'
  '^\.claude/(settings\.json|hooks/)'
  '^CLAUDE\.md$'
  '^AGENTS\.md$'
  '^package\.json$'
  '^bun\.lock$'
  '^apps/[^/]+/package\.json$'
  '^packages/[^/]+/package\.json$'
  '^plugins/[^/]+/package\.json$'
  '^apps/runtime/src/(routes|server|plugins|pool|worker)'
  '^plugins/[^/]+/(manifest\.ya?ml|plugin\.ts|server/|client/)'
  '^packages/shared/src/(errors|logger|utils)'
  '^packages/(database|keyval)/src/'
  '^charts/'
  '^\.github/workflows/'
  '^scripts/'
)

hint_for() {
  case "$1" in
    .mcp.json|.codex/*|.claude/*) echo "wiki/QMD.md and wiki/log.md (agent/QMD tooling)" ;;
    CLAUDE.md|AGENTS.md) echo "root rules plus wiki references if behavior changed" ;;
    package.json|bun.lock|*/package.json) echo "wiki/apps/packages.md or wiki/ops/local-dev.md" ;;
    apps/runtime/src/routes/*) echo "wiki/apps/runtime-api-reference.md" ;;
    apps/runtime/src/*|apps/runtime/src/*/*) echo "wiki/apps/runtime.md" ;;
    plugins/*) echo "wiki/apps/plugin-<name>.md" ;;
    packages/shared/*) echo "wiki/apps/packages.md" ;;
    packages/database/*|packages/keyval/*|*schema*) echo "wiki/data/ or relevant wiki/apps page" ;;
    charts/*) echo "wiki/ops/helm-charts.md or wiki/ops/release-flow.md" ;;
    .github/workflows/*) echo "wiki/ops/release-flow.md or wiki/ops/jsr-publish.md" ;;
    scripts/*) echo "wiki/ops/ or wiki/agents/" ;;
    *) echo "wiki/apps/ or wiki/ops/" ;;
  esac
}

MATCHED=""
COUNT=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  case "$file" in
    wiki/*) continue ;;
  esac

  for pattern in "${SENSITIVE_PATTERNS[@]}"; do
    if printf '%s\n' "$file" | grep -qE "$pattern"; then
      hint="$(hint_for "$file")"
      MATCHED="${MATCHED}  - ${file} -> ${hint}"$'\n'
      COUNT=$((COUNT + 1))
      break
    fi
  done
done <<< "$CHANGED"

if [ "$COUNT" -eq 0 ]; then
  exit 0
fi

touch "$STATE_FILE"

REASON="Touched ${COUNT} sensitive Buntime file(s). Evaluate whether the wiki needs an update before ending:

${MATCHED}
Triggers in CLAUDE.md: gotcha, canonical decision, schema/env/contract, reusable pattern, dependency quirk, or scope clarification.

If yes: edit wiki/<dest>, add a top entry to wiki/log.md, and run:
  qmd --index buntime update && qmd --index buntime embed

If not applicable: state \"sem ingest\" to unblock Stop. This reminder fires once per session."

jq -n --arg reason "$REASON" '{
  decision: "block",
  reason: $reason
}'

exit 0
