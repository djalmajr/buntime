# Build Commands Rule

**IMPORTANT:** Never run `bun dev` or `bun run build` commands during development sessions.

These commands should only be run by the user manually to:

- **`bun dev`**: Start development servers when the user explicitly wants to work on the application
- **`bun run build`**: Build the application to test compilation or before deployment

## Rationale

1. **Performance**: Build commands are expensive and unnecessary during code editing sessions
2. **User Control**: The user should control when to start development servers or trigger builds
3. **Workflow**: Development follows an edit → test → build cycle controlled by the user
4. **Resource Usage**: Prevents unnecessary CPU/memory usage during code analysis

## When to Build

Only build when:
- The user explicitly requests it with "build the app" or similar commands
- Testing compilation errors after significant changes
- Before deployment workflows
- When the user says "start dev server" or "run dev"

## Alternative Commands

Instead of building, prefer:
- Code analysis and static checks
- Lint checks only if requested
- Type checking only if requested
- File exploration and code review