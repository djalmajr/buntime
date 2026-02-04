# Code Quality Hook

Automated code quality checks for modified files.

## Purpose

- Run lint checks after file edits
- Verify build, lint, and tests before completing a plan
- Cache results to avoid redundant checks

## Features

### Post-Edit Lint (Warning)

After editing a file, runs the appropriate linter and reports warnings. Does not block the edit.

### Pre-Complete Verification (Blocking)

Before marking a plan as done, runs:
1. Build (`go build ./...`)
2. Lint (`golangci-lint run --fast`)
3. Tests (optional, disabled by default)

Blocks completion if any check fails.

## Usage

### Claude Code

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|mcp_edit|mcp_write",
        "hooks": [
          {
            "type": "command",
            "command": "bun run \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/code-quality/index.ts post-tool-use",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Manual Verification

```bash
bun run .claude/hooks/code-quality/index.ts verify
```

## Configuration

Create `.claude/hooks/code-quality/config.json`:

```json
{
  "lintEnabled": true,
  "testEnabled": false,
  "lintCommands": {
    "go": "golangci-lint run --fast %FILE%"
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `lintEnabled` | `true` | Run lint after edits |
| `testEnabled` | `false` | Run tests before completion |
| `lintCommands` | see code | Lint commands by language |
| `testCommands` | see code | Test commands by language |
| `ignorePatterns` | see code | Files to skip |

## Supported Languages

| Language | Linter | File Pattern |
|----------|--------|--------------|
| Go | golangci-lint | `*.go` |
| TypeScript | eslint | `*.ts`, `*.tsx` |
| JavaScript | eslint | `*.js`, `*.jsx` |

## Storage

No persistent storage. Lint runs fresh on each edit.

## Files

```
.claude/hooks/code-quality/
├── index.ts           # Entry point
├── config.ts          # Configuration
├── db.ts              # Cache database
├── types.ts           # TypeScript types
├── checkers/
│   └── lint.ts        # Lint checker
├── handlers/
│   ├── post-tool-use.ts   # Post-edit lint
│   ├── pre-complete.ts    # Verification
│   └── index.ts           # Exports
└── README.md          # This file
```

## Bypass

If you need to skip verification:

```bash
# Claude Code
/bypass-quality

# Or complete the plan without verification
```
