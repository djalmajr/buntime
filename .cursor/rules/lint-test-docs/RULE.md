---
description: "All code changes MUST pass lint, test, and have updated docs before being considered complete"
alwaysApply: true
---

# Lint, Test, and Documentation Requirements

**All code changes MUST pass lint, test, and have updated docs before being considered complete**

## Requirements

Before any task can be marked as complete:

1. Run `bun lint` - Must have zero errors
2. Run `bun test` - All tests must pass
3. Update documentation if API changed

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

## Workflow

1. Write the code
2. Run `bun lint` to fix format and check types
3. Write tests for new functionality
4. Run `bun test` to verify tests pass
5. Update/add documentation for API changes
6. Only then is the task complete

## Documentation Requirements

When API changes occur:

- **New functions/methods**: Add JSDoc and update relevant `.adoc` files
- **Changed signatures**: Update JSDoc, types, and `.adoc` examples
- **Removed functions**: Remove from docs, add migration notes if needed
- **New options/parameters**: Document in JSDoc and `.adoc`

## Exceptions

None. All code must pass lint, test, and have updated docs.

