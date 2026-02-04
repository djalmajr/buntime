---
description: Generate commit message and commit staged changes
hooks:
  PreToolUse:
    - matcher: "Bash|mcp_bash"
      hooks:
        - type: command
          command: "bun run \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/git-guard/index.ts bypass"
          once: true
---

## Task

Analyze staged changes and create a commit following Conventional Changelog format.

## Current State

Staged changes:
!`git diff --cached --stat`

Unstaged changes:
!`git diff --stat`

## Instructions

1. **If staged changes exist**: Commit ONLY staged changes (ignore unstaged)
2. **If NO staged changes**: Run `git add .` first, then commit all

3. Analyze changes to determine:
   - **type**: feat, fix, docs, refactor, chore, test, style
   - **scope**: affected area (optional)
   - **description**: concise summary (past tense)

4. Generate message: `type(scope): description`
5. Execute: `git commit -m "message"`
6. Show: `git log -1 --oneline`

## Format Rules

- Use past tense ("added" not "add")
- Max 72 chars first line
- No period at end
- Lowercase after colon

## Examples

- `feat(auth): added login functionality`
- `fix(api): fixed null pointer in handler`
- `refactor(parser): extracted validation logic`
- `chore(deps): updated dependencies`
- `docs(readme): updated installation instructions`
