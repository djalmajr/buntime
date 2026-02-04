# Git Guard Hook

Blocks dangerous git operations and requires explicit user confirmation.

## Purpose

Prevents accidental commits, pushes, and destructive git operations. Agents should prepare changes but let users review and commit manually.

## Blocked Operations

| Pattern | Examples |
|---------|----------|
| `git commit` | `git commit -m "message"`, `git commit --amend` |
| `git add` | `git add .`, `git add -A` |
| `git push` | `git push`, `git push origin main` |
| `git stash` | `git stash`, `git stash pop` |
| `git reset --hard` | `git reset --hard HEAD~1` |
| `git rebase` | `git rebase main`, `git rebase -i` |
| `git merge` | `git merge feature-branch` |
| `git cherry-pick` | `git cherry-pick abc123` |

## Allowed Operations

These read-only operations are always allowed:

- `git status` - Check repository state
- `git diff` - View changes
- `git log` - View history
- `git branch` - List branches
- `git show` - Show commits
- `git ls-files` - List tracked files
- `git checkout -b` - Create new branch
- `git fetch` - Fetch from remote
- `git pull` - Pull changes

## Usage

### Claude Code

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bun run .claude/hooks/git-guard/index.ts pre-bash"
          }
        ]
      }
    ]
  }
}
```

### OpenCode

Use the git-guard plugin (see plugins directory).

## Bypass

When you need to run a blocked git command, use the bypass command first:

```bash
# Claude Code
/bypass-git

# OpenCode
/git-bypass
```

The bypass is consumed after the next git operation.

## Configuration

Create `.claude/hooks/git-guard/config.json` to customize:

```json
{
  "blockedPatterns": ["git tag"],
  "allowedPatterns": ["git stash list"]
}
```

Patterns are appended to defaults (not replaced).

## Storage

Uses a simple file flag at `.claude/hooks/git-guard/.bypass`:

- Created when bypass is set
- Deleted when bypass is consumed

## Files

```
.claude/hooks/git-guard/
├── index.ts           # Entry point
├── config.ts          # Configuration loader
├── db.ts              # SQLite operations
├── types.ts           # TypeScript types
├── handlers/
│   ├── pre-bash.ts    # Blocks dangerous git commands
│   ├── bypass.ts      # Sets bypass flag
│   └── index.ts       # Handler exports
└── README.md          # This file
```

## Why This Exists

1. **Safety** - Prevents accidental commits of incomplete work
2. **Review** - Users should review changes before committing
3. **Control** - Commit messages should reflect human intent
4. **Audit** - Clear separation of agent vs human actions
