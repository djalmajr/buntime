---
description: List all plans with their status and progress
---

List all plans from the planning database.

Run this command to get the list:

```bash
bun run "$CLAUDE_PROJECT_DIR"/.claude/hooks/task-plan/cli.ts list
```

Display the results as a table showing:
- Plan ID (with * for active plan)
- Summary (TL;DR)
- Status (Pending, In Progress, Done)
- Progress (completed/total tasks)
- Last updated date

Mention that activation/selection is automatic based on the current context.
