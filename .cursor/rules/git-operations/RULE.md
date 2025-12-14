---
description: "Git operations - Never create commits automatically"
alwaysApply: true
---

# Git Operations

## Commits

**NEVER create git commits automatically.**

When the user asks to commit changes or at the end of a task:

1. ✅ Show a summary of what was done
2. ✅ Show git status to display modified files
3. ❌ DO NOT run `git commit`
4. ❌ DO NOT run `git add`
5. ❌ DO NOT stage any files

The user will create commits manually when they are ready.

## Pull Requests

**NEVER create pull requests automatically.**

When the user asks about creating a PR:

1. ✅ Show what changes were made
2. ✅ Suggest a PR title and description
3. ❌ DO NOT run `gh pr create`
4. ❌ DO NOT push to remote branches

The user will create PRs manually when they are ready.

## Pushing Changes

**NEVER push changes to remote repositories automatically.**

- ❌ DO NOT run `git push`
- ❌ DO NOT run `git push -u origin <branch>`

The user will push changes manually when they are ready.

## What You CAN Do

✅ Run `git status` to show current state
✅ Run `git diff` to show changes
✅ Run `git log` to show history
✅ Create and switch branches (`git checkout -b <branch>`)
✅ Read git information

## Summary

**You are a read-only assistant for git operations beyond local branching.**

Let the user have full control over:
- Staging files
- Creating commits
- Pushing to remote
- Creating pull requests
