---
title: "Testing patterns for agents"
audience: agents
sources:
  - .agents/rules/testing.md (removed 2026-05-02 — content lives here)
updated: 2026-05-02
tags: [testing, mocks, patterns, agents]
status: stable
---

# Testing patterns for agents

> Reusable patterns for writing tests in this repo. The framework rule lives in [`/CLAUDE.md`](../../CLAUDE.md#testing) (always run `bun test` before reporting complete; `*.test.ts` colocated). This page documents the **how** — concrete mocks and structures that recur across `apps/runtime/` and `plugins/*/`.

When in doubt about a pattern, **read an existing `*.test.ts` file in the same workspace first** — they are the canonical reference. The patterns below summarize what you'll find there.

## Framework

- `bun:test` (Jest-compatible). Imports: `import { describe, it, expect, beforeAll, afterAll, beforeEach, mock, spyOn } from "bun:test"`.
- Test files live next to the source they test: `pool.ts` → `pool.test.ts`, `plugin.ts` → `plugin.test.ts`. **Never** in a separate `__tests__/` directory.
- Run from any workspace: `bun test`. Watch mode: `bun test:watch`. Coverage: `bun test:coverage`. Single file: `bun test src/foo.test.ts`. Pattern: `bun test --grep "should handle"`.

## Test skeleton

```typescript
import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";

describe("MyModule", () => {
  beforeAll(() => {
    // one-time setup (init config, create temp dirs)
  });

  afterAll(() => {
    // one-time cleanup (rm temp dirs)
  });

  describe("methodName", () => {
    it("should do something", () => {
      expect(result).toBe(expected);
    });

    it("should handle async", async () => {
      await expect(asyncFn()).resolves.toBe(value);
    });

    it("should throw with code", () => {
      expect(() => fn()).toThrow("message");
    });
  });
});
```

Naming convention: `it("should <expected behavior> when <condition>")`. Arrange-Act-Assert structure inside each test.

## Mocking patterns

### `WorkerPool` mock

When a plugin or route handler depends on the worker pool, build a minimal mock that exposes only what the test needs:

```typescript
const createMockPool = (overrides = {}) => {
  const fetchMock = mock(() => Promise.resolve(new Response("worker response")));
  return {
    fetch: fetchMock,
    getMetrics: () => ({
      cacheHitRate: 0.8,
      requestCount: 100,
      avgRequestDuration: 10,
    }),
    getWorkerStats: () => ({}),
    shutdown: () => {},
    ...overrides,
    fetchMock, // exposed so the test can assert on calls
  };
};
```

Use the returned `fetchMock` to assert: `expect(pool.fetchMock).toHaveBeenCalledWith(appDir, config, expect.any(Request))`.

### `PluginContext` mock

For plugin tests that exercise `onInit`, `onRequest`, or service registry usage:

```typescript
const createMockContext = (overrides = {}) => ({
  config: {},
  globalConfig: { workerDirs: [], poolSize: 10 },
  logger: {
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
  },
  pool: createMockPool(),
  registerService: mock(),
  getService: mock(),
  ...overrides,
});
```

Override per test: `createMockContext({ config: { url: "test://" } })` for plugin-database, etc.

### Hono app testing

Routes are testable directly via `app.fetch()` — no need to spin up an HTTP server:

```typescript
import { Hono } from "hono";

const app = new Hono();
app.get("/test", (c) => c.json({ ok: true }));

const res = await app.fetch(new Request("http://localhost/test"));
expect(res.status).toBe(200);
expect(await res.json()).toEqual({ ok: true });
```

For routes that read headers (CSRF, `X-API-Key`), build the `Request` with explicit headers:

```typescript
const res = await app.fetch(
  new Request("http://localhost/api/protected", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "X-API-Key": "test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ field: "value" }),
  }),
);
```

### Function and method spies

```typescript
const mockFn = mock(() => "value");
mockFn();
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);

const spy = spyOn(object, "method");
object.method();
expect(spy).toHaveBeenCalled();
```

## Setup and teardown

### Temporary directory pattern

For tests that need a real filesystem (plugin loader, deployment writes, app discovery):

```typescript
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, ".test-mymodule");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  initConfig({ baseDir: TEST_DIR });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});
```

Conventions:
- Prefix the temp dir with `.test-` so it is git-ignored if accidentally committed.
- Always pair `mkdirSync` with `rmSync` — leaking dirs poisons subsequent runs.
- Put the temp dir under `import.meta.dir` so it lives next to the test file.

### Plugin lifecycle test

For end-to-end plugin tests that exercise `onInit` → `routes` → `onShutdown`:

```typescript
import { describe, it, expect, beforeAll, mock } from "bun:test";
import createPlugin from "./plugin";

describe("plugin-example", () => {
  let plugin;
  let mockContext;

  beforeAll(async () => {
    mockContext = createMockContext();
    plugin = createPlugin({ option: "value" });
    await plugin.onInit?.(mockContext);
  });

  it("should expose routes", () => {
    expect(plugin.routes).toBeDefined();
  });

  it("should handle request", async () => {
    const req = new Request("http://localhost/api/endpoint");
    const res = await plugin.routes.fetch(req);
    expect(res.status).toBe(200);
  });
});
```

## Assertion reference

```typescript
// Equality
expect(value).toBe(exact);              // ===
expect(value).toEqual(deep);            // deep equality
expect(value).toStrictEqual(deep);      // deep + same types

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();

// Numbers
expect(num).toBeGreaterThan(n);
expect(num).toBeGreaterThanOrEqual(n);
expect(num).toBeLessThan(n);
expect(num).toBeCloseTo(n, decimals);

// Strings
expect(str).toMatch(/regex/);
expect(str).toContain("substring");

// Arrays / objects
expect(arr).toContain(item);
expect(arr).toHaveLength(n);
expect(obj).toHaveProperty("key");
expect(obj).toHaveProperty("key", value);

// Errors
expect(fn).toThrow();
expect(fn).toThrow("message");
expect(fn).toThrow(ErrorClass);

// Async
await expect(promise).resolves.toBe(value);
await expect(promise).rejects.toThrow();
```

## Error testing

When a route should throw an `AppError`-derived error and the Hono error handler converts it to JSON:

```typescript
import { ValidationError } from "@buntime/shared/errors";

it("should return 400 with code on missing field", async () => {
  const res = await app.fetch(
    new Request("http://localhost/api/users", {
      method: "POST",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }), // missing email
    }),
  );
  expect(res.status).toBe(400);

  const body = await res.json();
  expect(body.code).toBe("MISSING_EMAIL");
});
```

Always assert on `body.code` (the SCREAMING_SNAKE_CASE error code), not on `body.message` — messages may evolve, codes are contract.

## Anti-patterns

- **Don't** spin up `Bun.serve` for unit tests — use `app.fetch(new Request(...))` directly. Reserve `Bun.serve` for integration tests (`apps/runtime/perf/` style).
- **Don't** mock `@buntime/shared/errors` — the real classes are cheap and the JSON shape is part of the contract.
- **Don't** use `setTimeout` for "wait for async" — use `await` on the promise or `vi.useFakeTimers()`-style approaches if available. Flaky timing tests waste CI runs.
- **Don't** share state between tests via module-level `let` — reset in `beforeEach`.

## Cross-refs

- Behavioral testing rule (always run `bun test` before reporting complete): [`/CLAUDE.md`](../../CLAUDE.md#testing)
- Worker pool internals (what to mock and what stays real): [`worker-pool`](../apps/worker-pool.md)
- Plugin lifecycle (what `onInit` / `onShutdown` see): [`plugin-system`](../apps/plugin-system.md)
- Error contract (`AppError` and friends): [`packages`](../apps/packages.md#buntimeshared)
