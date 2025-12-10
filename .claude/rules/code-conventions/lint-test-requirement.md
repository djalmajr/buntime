# Lint and Test Requirement

**RULE: All code changes MUST pass lint and test before being considered complete**

## Requirement

Before any task can be marked as complete:

1. Run `bun lint` - Must have zero errors
2. Run `bun test` - All tests must pass

## Commands

```bash
# Run lint (format + types)
bun lint

# Run tests
bun test

# Run both in sequence
bun lint && bun test
```

## Package-Specific Commands

For individual packages:

```bash
# plugin-keyval
cd plugins/plugin-keyval && bun lint && bun test

# keyval client
cd packages/keyval && bun lint && bun test
```

## What Lint Checks

- **lint:format** - Biome formatter/linter (code style, potential bugs)
- **lint:types** - TypeScript type checking (type errors)

## When Writing New Code

1. Write the code
2. Run `bun lint` to fix format and check types
3. Write tests for new functionality
4. Run `bun test` to verify tests pass
5. Only then is the task complete

## Exceptions

None. All code must pass lint and test.
