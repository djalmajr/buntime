---
description: Manually mark active plan as done (optional)
---

Mark the active plan as completed.

Run:

```bash
bun run .claude/hooks/task-plan/cli.ts complete
```

Before running, check the current state and warn if there are pending tasks:

```bash
bun run .claude/hooks/task-plan/cli.ts show
```

This is optional; normal planning lifecycle is automatic.
