---
description: List all plans with their status and progress
---

List all plans from the planning database.

Run this command to get the list:

```bash
bun run .claude/hooks/task-plan/cli.ts list
```

Display the results as a table showing:
- Plan ID (with * for active plan)
- Summary (TL;DR)
- Status (Pending, In Progress, Done)
- Progress (completed/total tasks)
- Last updated date

If the user wants to activate a plan, use:
```bash
bun run .claude/hooks/task-plan/cli.ts activate <plan-id>
```
