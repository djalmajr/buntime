---
name: planning
summary: |
  - ALL file modifications require an active plan
  - Create plan in .opencode/plans/{name}.md with Status + Checklist
  - Use TodoWrite to sync progress with plan checklist
  - NEVER git commit/push/add - user does manually
  - Run tests (bun test) before completing
  - Update plan status to "Done" when finished
  - Ask when instructions are not 100% clear
---

# Core Rules

## Planning Workflow

### When to Plan

**ALL file modifications require a plan.** This is enforced by the planning-enforcer plugin.

**Create a plan for:**
- Any code change, no matter how small
- Bug fixes (simple or complex)
- Refactoring
- New features

**Answer directly (no plan needed) for:**
- Questions, explanations, documentation queries
- Reading/analyzing code without modifications
- Running commands that don't modify files (git status, tests, etc.)

### Plan Files

All plans are stored in `.opencode/plans/` folder.

#### Structure

Plans can be simple or detailed depending on the task complexity:

**Simple tasks (1-2 steps):** Minimal plan with Status + Checklist
**Complex tasks (3+ steps):** Full plan with Objective, Files, Checklist, Verification

#### Minimal Plan (simple tasks)

```markdown
# Fix: Remove re-exports from config.ts

**Status:** In Progress

## Checklist

- [ ] Remove re-export lines from `apps/runtime/src/libs/pool/config.ts`
- [ ] Run tests
```

#### Full Plan Structure (complex tasks)

```markdown
# Plan: {feature-name}

**Status:** Pending | In Progress | Done
**Date:** YYYY-MM-DD

## Objective

What will be accomplished and why.

## Files to Modify

| File | Change |
|------|--------|
| `path/to/file.ts` | Description of change |

## Implementation Checklist

- [ ] Step 1: Description
- [ ] Step 2: Description
  - [ ] Sub-step 2.1
  - [ ] Sub-step 2.2
- [ ] Step 3: Description

## Documentation

List documentation files that need to be updated:

| File | Change |
|------|--------|
| `docs/...` | What to document |

## Verification

- [ ] Tests passing
- [ ] Build successful
- [ ] Documentation updated
- [ ] Manual testing done

## Notes

Any discoveries, blockers, or deviations from original plan.
```

#### Maintaining Plans

1. **Update checklist** - Mark `[x]` as steps complete
2. **Add notes** - Document discoveries or blockers
3. **Update status** - Change to "In Progress" → "Done"
4. **Keep as history** - Plans serve as documentation

---

### Task Tracking with TodoWrite

Use TodoWrite to track progress during the current session. This shows the user real-time progress.

#### When to Use

- Always use with an active plan
- Sync TodoWrite tasks 1:1 with plan checklist items
- Shows user real-time progress

#### Task States

| State | Meaning |
|-------|---------|
| `pending` | Not yet started |
| `in_progress` | Currently working (only 1 at a time) |
| `completed` | Finished and verified |
| `cancelled` | No longer needed |

#### Best Practices

1. **One in_progress at a time** - Complete current task before starting next
2. **Mark complete immediately** - Don't batch completions
3. **Use priorities** - high, medium, low
4. **Keep descriptions concise** - 1-2 sentences max

#### Integration with Plans

When working with a plan:

1. **Create TodoWrite tasks** from the plan's checklist
2. **Work through tasks** one at a time
3. **Mark both** - TodoWrite task AND plan checklist `[x]`
4. **Sync status** - When all tasks done, update plan status to "Done"

**Example flow:**

```
Plan checklist:           TodoWrite:
- [ ] Add schema          pending: "Add schema"
- [ ] Update API          pending: "Update API"
- [ ] Add tests           pending: "Add tests"

Working on schema...

Plan checklist:           TodoWrite:
- [x] Add schema          completed: "Add schema"
- [ ] Update API          in_progress: "Update API"
- [ ] Add tests           pending: "Add tests"
```

---

### Workflow Steps

#### 1. Analyze the Request

- Understand what's being asked
- If it requires file modifications → create a plan
- If read-only (questions, analysis) → answer directly

#### 2. Create Plan

1. Create file: `.opencode/plans/{feature-name}.md`
2. Add **Status:** In Progress
3. Add checklist with tasks (- [ ] ...)
4. For complex tasks: add Objective, Files table, Verification section
5. Present plan to user and **wait for confirmation**

#### 3. Create TodoWrite Tasks

From the plan's checklist, create TodoWrite tasks:

```
Plan: "Add user authentication"
Checklist:
- [ ] Create auth middleware
- [ ] Add login endpoint
- [ ] Add tests

→ TodoWrite tasks:
- pending: Create auth middleware
- pending: Add login endpoint
- pending: Add tests
```

#### 4. Implement

1. Mark first task as `in_progress`
2. Implement the change
3. Verify it works (tests, manual check)
4. Mark task `completed` in TodoWrite
5. Mark step `[x]` in plan checklist
6. Move to next task

#### 5. Verify & Complete

Before marking final task complete:

- [ ] All tests passing
- [ ] Build successful
- [ ] Manual testing (if applicable)
- [ ] Plan checklist fully checked
- [ ] Plan status updated to "Done"

---

## Safety Rules

### Ask When Not Clear

**If ANY instruction is not 100% clear, ALWAYS ask:**

- "run the services" → Local or deploy?
- "clean this" → Delete or reset?
- "fix" → What specific problem?
- "improve" → Performance, readability, or what?

**When in doubt → ASK**

### Verification Before Changes

**Before ANY code change:**

1. **READ** the current code completely
2. **VERIFY** consistency (schema vs validation vs routes)
3. **NOTIFY** user about discrepancies before changing
4. **WAIT** for confirmation

**Code is the source of truth**, not assumptions.

### Dangerous Actions

**ALWAYS ask permission before:**

- Modifying IAM/permissions
- Deploying or running migrations
- Deleting data or files
- Git operations (commits, push, PRs)
- Installing packages (npm, pip, brew)
- Modifying production/staging
- Destructive commands (rm -rf, DROP, TRUNCATE)

**Process:**
1. Identify dangerous action
2. Explain what will be done and risks
3. Wait for explicit authorization
4. Execute only after confirmation

---

## Git Operations

### Commits

**NEVER create git commits automatically.**

When the user asks to commit or at the end of a task:

1. Show a summary of what was done
2. Show `git status` to display modified files
3. **DO NOT** run `git commit`
4. **DO NOT** run `git add`
5. **DO NOT** stage any files

The user will create commits manually.

**Additional rules:**
- Never mention "Claude", "AI", or "Anthropic" in commit messages
- No signatures like "Co-Authored-By: Claude"

### Pull Requests

**NEVER create pull requests automatically.**

When the user asks about creating a PR:

1. Show what changes were made
2. Suggest a PR title and description
3. **DO NOT** run `gh pr create`
4. **DO NOT** push to remote branches

### Pushing Changes

**NEVER push changes to remote repositories automatically.**

- **DO NOT** run `git push`
- **DO NOT** run `git push -u origin <branch>`

### What You CAN Do

- Run `git status` to show current state
- Run `git diff` to show changes
- Run `git log` to show history
- Create and switch branches (`git checkout -b <branch>`)
- Read git information
