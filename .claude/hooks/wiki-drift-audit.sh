#!/usr/bin/env bash
# wiki-drift-audit.sh - Claude Code SessionStart hook
# Reports tracked markdown files outside the Buntime wiki policy allowlist.

set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"
SOURCE="$(printf '%s' "$INPUT" | jq -r '.source // "unknown"' 2>/dev/null || echo "unknown")"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT" 2>/dev/null || exit 0

# Mirror of is_allowed_markdown() in .claude/hooks/wiki-policy-check.sh.
ALLOWED='^(README|AGENTS|CLAUDE)\.md$|^(apps|packages|plugins)/[^/]+/README\.md$|^charts/(README|release-notes)\.md$|^wiki/.*\.md$|^\.github/.*\.md$|^\.claude/.*\.md$|^\.codex/.*\.md$'

DRIFT="$(git ls-files '*.md' 2>/dev/null | grep -Ev "$ALLOWED" || true)"
COUNT="$(printf '%s' "$DRIFT" | grep -c . || true)"

if [ "$COUNT" -eq 0 ]; then
  exit 0
fi

EXAMPLES="$(printf '%s\n' "$DRIFT" | head -10 | sed 's/^/  - /')"
EXTRA=""
if [ "$COUNT" -gt 10 ]; then
  EXTRA=$'\n  ... and '"$((COUNT - 10))"' more.'
fi

CONTEXT="wiki-drift-audit (source=${SOURCE}): ${COUNT} tracked .md file(s) are outside the Buntime markdown allowlist. These are legacy docs/plans tolerated for edits but not for new documentation. First examples:

${EXAMPLES}${EXTRA}

When touching one of these files, decide whether the content is still canonical. If yes, migrate it to wiki/ with /wiki-ingest, update wiki/log.md, reindex QMD, and remove the drift. If it is obsolete, remove it."

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'

exit 0
