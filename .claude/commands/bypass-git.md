---
description: Allow next blocked git command
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Bash|mcp_bash"
      hooks:
        - type: command
          command: "bun run \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/git-guard/index.ts bypass"
          once: true
---

Bypass activated. The next git command will be allowed.
