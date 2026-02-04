---
description: Mark the active plan as completed
---

Mark the active plan as completed.

First, check if there's an active plan:

```bash
bun run .claude/hooks/task-plan/cli.ts show
```

If there are pending tasks, warn the user and ask for confirmation.

Then run code quality verification:

```bash
bun run .claude/hooks/code-quality/index.ts verify
```

If verification fails, show the errors and ask the user to fix them before completing.
If user wants to skip verification, they can use `/bypass-quality`.

If all checks pass (or bypassed), mark the plan as complete:

```bash
bun run .claude/hooks/task-plan/cli.ts complete
```

Then suggest next steps:
1. Review changes: `git status` and `git diff`
2. Commit manually when ready
