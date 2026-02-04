---
description: Generate commit message and commit staged changes
---

## Task

Analyze staged changes and create a commit following Conventional Changelog format.

## Current State

Staged:
!`git diff --cached --stat`

Unstaged:
!`git diff --stat`

## Instructions

1. **If staged exists**: Commit ONLY staged (ignore unstaged)
2. **If NO staged**: Run `git add .` first

3. Determine type: feat, fix, docs, refactor, chore, test, style
4. Bypass git: !`bun run .claude/hooks/git-guard/index.ts bypass`
5. Execute: `git commit -m "type(scope): description"`
6. Show: `git log -1 --oneline`

## Format

- Past tense ("added" not "add")
- Max 72 chars
- No period at end

## Examples

- `feat(auth): added login functionality`
- `fix(api): fixed null pointer in handler`
- `refactor(parser): extracted validation logic`
- `chore(deps): updated dependencies`
