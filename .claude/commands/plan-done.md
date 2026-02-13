---
description: Mark the active plan as completed
---

Mark the active plan as completed.

First, check if there's an active plan:

```bash
bun run "$CLAUDE_PROJECT_DIR"/.claude/hooks/task-plan/cli.ts show
```

If there are pending tasks, warn the user and ask for confirmation.

Then run code quality verification:

```bash
bun run "$CLAUDE_PROJECT_DIR"/.claude/hooks/code-quality/index.ts verify
```

If verification fails, show the errors and ask the user to fix them before completing.
If verification fails, stop and report the issues clearly.

If all checks pass (or bypassed), mark the plan as complete:

```bash
bun run "$CLAUDE_PROJECT_DIR"/.claude/hooks/task-plan/cli.ts complete
```

Then suggest next steps:
1. Review changes: `git status` and `git diff`
2. Commit manually when ready

This command is optional; plan lifecycle is automatic.
