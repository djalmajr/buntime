# Constants Naming Convention

## Object Constants: PascalCase

Object constants with `as const` should use **PascalCase**, not UPPER_SNAKE_CASE.

```typescript
// CORRECT - PascalCase for object constants
export const Headers = {
  BASE: "x-base",
  FRAGMENT_ROUTE: "x-fragment-route",
} as const;

export const MessageTypes = {
  ERROR: "ERROR",
  READY: "READY",
} as const;

export const BodySizeLimits = {
  DEFAULT: 10 * 1024 * 1024,
  MAX: 100 * 1024 * 1024,
} as const;

// WRONG - UPPER_SNAKE_CASE for objects
export const HEADERS = { ... } as const;
export const MESSAGE_TYPES = { ... } as const;
```

## Scalar Constants: UPPER_SNAKE_CASE

Simple scalar values (numbers, strings) use **UPPER_SNAKE_CASE**.

```typescript
// CORRECT - UPPER_SNAKE_CASE for scalars
export const DELAY_MS = 100;
export const SHUTDOWN_TIMEOUT_MS = 30_000;
export const VERSION = "1.0.0";
```

## Why Not Enums?

Prefer `as const` objects over TypeScript enums:

1. **Better tree-shaking** - Unused values are removed by bundlers
2. **More flexible** - Can use computed values, spreads, etc.
3. **Simpler transpilation** - No runtime overhead
4. **Type inference** - Works better with mapped types

```typescript
// PREFERRED - as const object
export const WorkerState = {
  ACTIVE: "active",
  IDLE: "idle",
} as const;

export type WorkerStatus = (typeof WorkerState)[keyof typeof WorkerState];

// AVOID - enum
enum WorkerState {
  ACTIVE = "active",
  IDLE = "idle",
}
```
