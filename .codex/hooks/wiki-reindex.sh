#!/usr/bin/env bash
# wiki-reindex.sh - Codex PostToolUse hook
# Auto-reindex the QMD `buntime` wiki collection whenever Codex edits wiki/*.md.
# Debounces in a 3s window so a burst of edits triggers only one reindex.
# Runs detached and logs failures so stale indexes do not fail silently.

set -euo pipefail

INPUT="$(cat)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
WIKI_DIR="$ROOT/wiki"

TOOL="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')"

case "$TOOL" in
  apply_patch|Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

changed_wiki_md=false

while IFS= read -r file; do
  [ -n "$file" ] || continue

  case "$file" in
    /*) absolute="$file" ;;
    *) absolute="$ROOT/$file" ;;
  esac

  case "$absolute" in
    "$WIKI_DIR"/*.md|"$WIKI_DIR"/*/*.md|"$WIKI_DIR"/*)
      case "$absolute" in
        *.md) ;;
        *) continue ;;
      esac
      changed_wiki_md=true
      break
      ;;
  esac
done < <(
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
)

if [ "$changed_wiki_md" != true ]; then
  exit 0
fi

STAMP_FILE="${TMPDIR:-/tmp}/qmd-buntime-reindex.stamp"
STAMP="$(date +%s%N)"
echo "$STAMP" > "$STAMP_FILE"

# Failures are non-fatal to the edit, but the log keeps them visible.
LOG_FILE="${TMPDIR:-/tmp}/qmd-buntime-reindex.log"
(
  sleep 3
  CURRENT="$(cat "$STAMP_FILE" 2>/dev/null || echo '')"
  if [ "$CURRENT" = "$STAMP" ]; then
    {
      printf '\n[%s] reindex triggered by codex edit\n' "$(date -Iseconds)"
      qmd --index buntime update 2>&1
      status=$?
      if [ "$status" -ne 0 ]; then
        printf '[WARN] qmd update failed (exit %d) - wiki may be unindexed\n' "$status"
      fi
      qmd --index buntime embed 2>&1
      status=$?
      if [ "$status" -ne 0 ]; then
        printf '[WARN] qmd embed failed (exit %d) - vectors may be stale\n' "$status"
      fi
    } >> "$LOG_FILE" 2>&1
  fi
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

exit 0
