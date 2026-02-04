---
description: Create a new plan interactively with required sections
---

# Create a New Plan

Help the user create a well-structured plan by gathering all required information.

## Required Information

### 1. Title
A short, descriptive name for the plan (e.g., "Add user authentication", "Fix payment validation bug").

### 2. Summary (TL;DR)
A concise 1-2 sentence summary. This is shown in lists and quick references.

### 3. Description
A detailed description with the following sections in **Markdown format**:

#### Required Sections

```markdown
## Context
Why are we doing this? What problem does it solve? Background information.

## Scope
What is INCLUDED and what is OUT OF SCOPE. Clearly delimits the work.

## Approach
How will we implement this? Technical decisions, architecture, patterns to follow.

## Acceptance Criteria
How do we know we're done? Objective criteria for completion.
```

#### Optional Sections (when relevant)

```markdown
## Affected Files
List of files to be modified/created (helps with planning).

## Risks & Considerations
What could go wrong? Edge cases? Dependencies? Breaking changes?

## References
Useful links: docs, issues, PRs, examples.
```

### 4. Tasks
A list of actionable steps to complete the plan.

## Process

1. Ask the user for:
   - What they want to accomplish (to understand context)
   - The scope (what's included/excluded)
   - Technical approach (if they have preferences)

2. Draft the plan with all sections

3. Review with the user and refine

4. Create the plan using the CLI:

```bash
bun run "$CLAUDE_PROJECT_DIR"/.claude/hooks/task-plan/cli.ts create \
  --id "<kebab-case-id>" \
  --title "<short-title>" \
  --summary "<tl;dr>" \
  --description "<full-markdown-description>" \
  --task "<task-1>" \
  --task "<task-2>" \
  ...
```

5. Activate the plan:

```bash
bun run "$CLAUDE_PROJECT_DIR"/.claude/hooks/task-plan/cli.ts activate "<id>"
```

6. Use TodoWrite to track progress on the tasks.

## Example

**User request:** "I need to add dark mode to the app"

**Generated plan:**

- **ID:** `add-dark-mode`
- **Title:** `Add Dark Mode Support`
- **Summary:** `Implement dark mode toggle with system preference detection and persistent user choice.`
- **Description:**
```markdown
## Context
Users have requested dark mode for better readability in low-light conditions and to reduce eye strain. This is a common feature in modern applications.

## Scope
**Included:**
- Dark mode toggle in settings
- System preference detection
- Persistent user preference (localStorage)
- Theme CSS variables for colors

**Out of scope:**
- Per-component theme customization
- Multiple color themes (only light/dark)

## Approach
1. Create CSS variables for theme colors in :root
2. Add [data-theme="dark"] selector for dark values
3. Create ThemeContext for React state management
4. Detect prefers-color-scheme on initial load
5. Store preference in localStorage

## Acceptance Criteria
- [ ] Toggle switches between light and dark mode
- [ ] Choice persists across browser sessions
- [ ] Respects system preference on first visit
- [ ] All components render correctly in both modes
```

- **Tasks:**
  1. Create CSS theme variables
  2. Add ThemeContext provider
  3. Implement theme toggle component
  4. Update components to use theme variables
  5. Add system preference detection
  6. Add localStorage persistence
  7. Test both modes

## Notes

- The `--description` can contain newlines - use proper shell quoting
- Tasks are tracked via TodoWrite with their IDs
- The plan serves as documentation - be thorough
