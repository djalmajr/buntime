---
description: Show the active plan with tasks and progress
---

Show the active plan from the planning database.

Run this command to get the plan details:

```bash
bun run .claude/hooks/task-plan/cli.ts show
```

Display the results showing:
- Title and status
- Summary (TL;DR)
- Task checklist with completion status and IDs
- Full description
- Modified files (if any)

If no active plan exists, inform the user and suggest creating one with `/plan-new`.
