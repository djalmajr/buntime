# Planning Enforcer

Unified planning workflow for Claude Code and OpenCode. Enforces structured planning before code modifications.

## Overview

The Planning Enforcer ensures that all code changes are preceded by a well-documented plan. This:
- Prevents ad-hoc changes without context
- Creates documentation as a side effect
- Tracks progress via tasks
- Maintains history of completed work

## Quick Start

### 1. Start working

No manual plan command is required in OpenCode. The plugin will:

- Create a plan automatically when none exists
- Reuse a matching plan when context is the same
- Create a new plan when context is different or uncertain
- Inform the user about every decision (create/reuse + reason)

### 2. Work on tasks

Use TodoWrite normally. Task status sync and modified-file tracking are automatic.

### 3. Optional manual maintenance

The CLI still exists for inspection/maintenance, but it is not required in the normal OpenCode flow.

## Commands

### Slash Commands

OpenCode no longer requires slash commands for planning. The lifecycle is automatic.

### CLI Commands

```bash
# Show active plan
bun run .claude/hooks/task-plan/cli.ts show

# List all plans
bun run .claude/hooks/task-plan/cli.ts list

# Create a plan
bun run .claude/hooks/task-plan/cli.ts create \
  --id <id> \
  --title <title> \
  --summary <summary> \
  --description <description> \
  [--task <task>...]

# Activate a plan
bun run .claude/hooks/task-plan/cli.ts activate <plan-id>

# Mark active plan as done
bun run .claude/hooks/task-plan/cli.ts complete

# Delete a plan
bun run .claude/hooks/task-plan/cli.ts delete <plan-id>

# Show help
bun run .claude/hooks/task-plan/cli.ts help
```

## Plan Structure

### Required Fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (kebab-case) |
| `title` | Short descriptive name |
| `summary` | TL;DR - concise 1-2 sentence summary |
| `description` | Full description with sections (Markdown) |

### Description Sections

The `description` should include these sections:

#### Required

```markdown
## Context
Why are we doing this? What problem does it solve?

## Scope
What's INCLUDED and what's OUT OF SCOPE.

## Approach
How will we implement? Technical decisions.

## Acceptance Criteria
How do we know we're done?
```

#### Optional

```markdown
## Affected Files
Files to be modified/created.

## Risks & Considerations
What could go wrong? Edge cases?

## References
Useful links: docs, issues, PRs.
```

### Tasks

Tasks are actionable steps tracked via TodoWrite:
- Each task has an ID used for syncing
- Mark tasks done via TodoWrite
- Progress is tracked automatically

## Storage

Plans and tasks are stored in SQLite (`store.db`):

```
.claude/hooks/task-plan/store.db
```

The database is created automatically on first use and should be in `.gitignore`.

### Schema

```sql
-- Plans table
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',  -- Pending | In Progress | Done
  modified_files TEXT DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT,
  is_active INTEGER DEFAULT 0
);

-- Tasks table
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  created_at TEXT,
  completed_at TEXT
);
```

## Directory Structure

```
.claude/hooks/task-plan/
├── cli.ts              # CLI entry point
├── index.ts            # Hook entry point
├── config.ts           # Configuration
├── types.ts            # TypeScript types
├── core/
│   ├── db.ts           # SQLite operations
│   ├── plan.ts         # Plan operations wrapper
│   ├── state.ts        # State operations wrapper
│   └── sync.ts         # TodoWrite sync
├── handlers/
│   ├── session-start.ts
│   ├── pre-tool-use.ts
│   ├── pre-bash.ts
│   ├── post-tool-use.ts
│   ├── todo-updated.ts
│   ├── stop.ts
│   └── bypass.ts
└── store.db            # SQLite database (gitignored)
```

## Configuration

Create `config.json` to override defaults:

```json
{
  "exemptPatterns": ["\\.http$", "^docs/"],
  "warnOnUnexpectedFiles": false,
  "maxStopAttempts": 3
}
```

### Exempt Patterns

Files matching these patterns can be edited without a plan:

- `.claude/`, `.opencode/` - Config directories
- `.env*`, `.gitignore` - Environment/git config
- `README.md`, `CHANGELOG.md`, `LICENSE` - Documentation
- `*.test.*`, `*.spec.*`, `_test.go` - Test files
- `__tests__/`, `__mocks__/`, `testdata/` - Test directories

## Git Conventions

### Blocked Commands

The enforcer blocks dangerous git operations:

| Command | Reason |
|---------|--------|
| `git commit` | User reviews and commits |
| `git add` | User stages files |
| `git push` | User pushes to remote |
| `git stash` | May lose work |
| `git reset --hard` | Destructive |
| `git rebase` | Requires manual review |
| `git merge` | Requires manual review |
| `git cherry-pick` | Requires manual review |

Use `/bypass-git` for emergencies.

### Allowed Commands

These are safe to run:

- `git status` - Show current state
- `git diff` - Show changes
- `git log` - Show history
- `git branch` - List/create branches
- `git checkout -b` - Create new branch
- `git fetch` - Fetch from remote
- `git pull` - Pull changes
- `git show` - Show commit details
- `git ls-files` - List tracked files

### Committing Changes

Use the `/commit` command which:

1. Shows staged/unstaged changes
2. Generates commit message in Conventional Changelog format
3. Bypasses the git block automatically

### Commit Message Format

```
type(scope): description
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `style`

**Examples:**

```
feat(auth): added login functionality
fix(api): fixed null pointer in handler
refactor(parser): extracted validation logic
chore(deps): updated dependencies
docs(readme): updated installation instructions
```

**Rules:**

- Use past tense ("added" not "add")
- Max 72 chars first line
- No period at end
- Lowercase after colon

### Pull Requests

When asked to create a PR:

1. Show what changes were made
2. Suggest a PR title and description
3. Let the user run `gh pr create` manually

### Branch Conventions

- Create branches for features: `git checkout -b feature/name`
- Use descriptive names: `feature/`, `fix/`, `refactor/`
- Keep main/master clean

## Bypass Commands

Only git bypass is relevant for OpenCode command flow:

| Command | Description |
|---------|-------------|
| `/bypass-git` | Allow next blocked git command |

## Platform Integration

### Claude Code

Hooks configured in `.claude/settings.json` call the index.ts entry point.

### OpenCode

Uses the thin adapter in `.opencode/plugins/task-plan.ts` which imports shared handlers.

## Troubleshooting

### Hook not running

1. Check Bun is installed: `bun --version`
2. Test CLI directly: `bun run .claude/hooks/task-plan/cli.ts show`

### Database issues

1. Delete `store.db` to reset (will lose all plans)
2. The database is recreated automatically

### Plan not activating

1. Check plan exists: `bun run cli.ts list`
2. Activate explicitly: `bun run cli.ts activate <id>`

## Requirements

- [Bun](https://bun.sh) runtime (for TypeScript execution)
