#!/usr/bin/env bash
# wiki-policy-check.sh - Codex PostToolUse hook
# Keep durable markdown documentation in wiki/. Only explicit repo-local
# markdown surfaces are allowed outside the canonical wiki.
#
# Behavior:
#   - New .md outside the allowlist -> exit 2 and block the tool.
#   - Existing tracked .md outside the allowlist -> warn only (legacy drift).

set -euo pipefail

INPUT="$(cat)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
WIKI_DIR="$ROOT/wiki"

TOOL="$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')"

case "$TOOL" in
  apply_patch|Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

payload_entries() {
  printf '%s' "$INPUT" |
    jq -r '
      [
        (.tool_input.file_path? | select(.) | "unknown\t" + .),
        (.tool_input.notebook_path? | select(.) | "unknown\t" + .),
        (.tool_response.filePath? | select(.) | "unknown\t" + .),
        ((.tool_input.edits? // [])[]? | .file_path? | select(.) | "unknown\t" + .),
        (
          (.tool_input.command? // "") |
          split("\n")[] |
          capture("^\\*\\*\\* (?<op>Add|Update|Delete) File: (?<path>.+)$")? |
          .op + "\t" + .path
        )
      ] | .[]? // empty
    '
}

repo_relative_file() {
  local file="$1"

  case "$file" in
    "$WIKI_DIR"/*|"$ROOT/wiki/"*|wiki/*) ;;
    "$ROOT"/*) printf '%s\n' "${file#"$ROOT"/}"; return 0 ;;
    /*) return 1 ;;
    ../*) return 1 ;;
    *) printf '%s\n' "$file"; return 0 ;;
  esac

  case "$file" in
    "$ROOT"/*) printf '%s\n' "${file#"$ROOT"/}" ;;
    *) printf '%s\n' "$file" ;;
  esac
}

is_allowed_markdown() {
  local rel="$1"
  case "$rel" in
    # Agent execution rules and minimal repo entry points.
    README.md|CLAUDE.md|AGENTS.md) return 0 ;;
    # Minimal package/application/plugin READMEs.
    apps/*/README.md|packages/*/README.md|plugins/*/README.md) return 0 ;;
    # Helm chart docs explicitly allowed by repo policy.
    charts/README.md|charts/release-notes.md) return 0 ;;
    # Canonical wiki and agent/tooling harness docs.
    wiki/*.md|wiki/**/*.md) return 0 ;;
    .github/*.md|.github/**/*.md) return 0 ;;
    .claude/*.md|.claude/**/*.md) return 0 ;;
    .codex/*.md|.codex/**/*.md) return 0 ;;
    *) return 1 ;;
  esac
}

is_tracked() {
  local rel="$1"
  ( cd "$ROOT" && git ls-files --error-unmatch -- "$rel" >/dev/null 2>&1 )
}

blocked_new=""
warned_existing=""

while IFS=$'\t' read -r op file; do
  [ -n "$file" ] || continue
  [ "$op" != "Delete" ] || continue

  rel="$(repo_relative_file "$file" || true)"
  [ -n "$rel" ] || continue

  case "$rel" in
    *.md) ;;
    *) continue ;;
  esac

  if is_allowed_markdown "$rel"; then
    continue
  fi

  if is_tracked "$rel"; then
    warned_existing="${warned_existing}
- ${rel}"
  else
    blocked_new="${blocked_new}
- ${rel}"
  fi
done < <(payload_entries)

if [ -n "$warned_existing" ]; then
  cat >&2 <<EOF
wiki-policy: edit in .md outside the allowlist (legacy drift, not blocking):${warned_existing}
Canonical Buntime documentation belongs in wiki/. Consider migrating this content with /wiki-ingest and removing the repo-local drift.
EOF
fi

if [ -n "$blocked_new" ]; then
  cat >&2 <<EOF
wiki-policy: blocked - new .md outside the allowlist:${blocked_new}

Policy: canonical Buntime documentation lives in wiki/.
Allowed repo-local markdown:
  - Top-level: README.md, CLAUDE.md, AGENTS.md
  - apps|packages|plugins/<name>/README.md
  - charts/README.md and charts/release-notes.md
  - wiki/**/*.md
  - .github/**/*.md, .claude/**/*.md, .codex/**/*.md

Action: remove the file and move durable content to the right wiki page:
  - architecture/plugins/packages/runtime -> wiki/apps/
  - deploy/charts/CI/env/performance/security/logging -> wiki/ops/
  - schemas/stores/file formats -> wiki/data/
  - reusable agent recipes -> wiki/agents/
  - ingest/migration summaries -> wiki/sources/
EOF
  exit 2
fi

exit 0
