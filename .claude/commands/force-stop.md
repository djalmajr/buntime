---
description: Allow exit with pending tasks
disable-model-invocation: true
hooks:
  Stop:
    - hooks:
        - type: command
          command: "bun run \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/task-plan/index.ts set-bypass stop"
          once: true
---

Force stop activated. Session can be ended with pending tasks.
