---
description: Create a new plan interactively with required sections
---

# Create a New Plan

Help the user create a well-structured plan by gathering all required information.

## Required Information

### 1. Title
A short, descriptive name for the plan.

### 2. Summary (TL;DR)
A concise 1-2 sentence summary.

### 3. Description
A detailed description with sections in **Markdown format**:

#### Required Sections
- **Context**: Why are we doing this?
- **Scope**: What's included/excluded?
- **Approach**: How will we implement?
- **Acceptance Criteria**: How do we know we're done?

#### Optional Sections
- **Affected Files**: Files to modify/create
- **Risks & Considerations**: What could go wrong?
- **References**: Useful links

### 4. Tasks
Actionable steps to complete the plan.

## Process

1. Ask the user about the task
2. Draft the plan with all sections
3. Review and refine
4. Create the plan:

```bash
bun run .claude/hooks/task-plan/cli.ts create \
  --id "<kebab-case-id>" \
  --title "<short-title>" \
  --summary "<tl;dr>" \
  --description "<full-markdown-description>" \
  --task "<task-1>" \
  --task "<task-2>"
```

5. Activate the plan:

```bash
bun run .claude/hooks/task-plan/cli.ts activate "<id>"
```

6. Use TodoWrite to track progress.
