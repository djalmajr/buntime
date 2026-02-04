---
description: Allow next file edit without active plan
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Edit|Write|mcp_edit|mcp_write"
      hooks:
        - type: command
          command: "bun run \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/task-plan/index.ts set-bypass plan"
          once: true
---

Bypass activated. The next file edit will be allowed without an active plan.
