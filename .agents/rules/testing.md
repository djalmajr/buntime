---
name: testing
summary: |
  - Framework: bun:test (describe, it, expect, mock, spyOn)
  - Test files: *.test.ts alongside source files
  - Run: bun test, bun test:watch, bun test:coverage
  - Mock patterns: WorkerPool, PluginContext, Hono routes
  - Setup/teardown: beforeAll, afterAll for temp dirs and config
  - Always run tests before completing a task
---

# Testing Guide

## Framework

Buntime uses `bun:test` - Bun's built-in test runner (Jest-compatible API).

## File Structure

Test files live alongside source files:

```
src/
├── app.ts
├── app.test.ts      # Tests for app.ts
├── config.ts
├── config.test.ts
└── libs/
    ├── pool/
    │   ├── pool.ts
    │   └── pool.test.ts
```

## Running Tests

```bash
# Run all tests (all workspaces)
bun test

# Watch mode
bun test:watch

# With coverage
bun test:coverage

# Specific file
bun test src/app.test.ts

# Pattern matching
bun test --grep "should handle"

# Single workspace
bun test --filter @buntime/runtime
```

## Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";

describe("MyModule", () => {
  beforeAll(() => {
    // Setup once before all tests (e.g., init config, create temp dirs)
  });

  afterAll(() => {
    // Cleanup after all tests (e.g., remove temp dirs)
  });

  beforeEach(() => {
    // Reset before each test
  });

  describe("methodName", () => {
    it("should do something", () => {
      expect(result).toBe(expected);
    });

    it("should handle async", async () => {
      await expect(asyncFn()).resolves.toBe(value);
    });

    it("should throw error", () => {
      expect(() => fn()).toThrow("error message");
    });
  });
});
```

## Mocking

### Functions

```typescript
import { mock, spyOn } from "bun:test";

// Mock function
const mockFn = mock(() => "mocked value");
mockFn();
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);

// Spy on existing function
const spy = spyOn(object, "method");
object.method();
expect(spy).toHaveBeenCalled();
```

### WorkerPool Mock

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
    fetchMock,
  };
};
```

### PluginContext Mock

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

### Hono App Testing

```typescript
import { Hono } from "hono";

const app = new Hono();
app.get("/test", (c) => c.json({ ok: true }));

// Test request
const res = await app.fetch(new Request("http://localhost/test"));
expect(res.status).toBe(200);
expect(await res.json()).toEqual({ ok: true });
```

## Temp Directory Pattern

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

## Plugin Testing Pattern

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

  it("should have routes", () => {
    expect(plugin.routes).toBeDefined();
  });

  it("should handle request", async () => {
    const req = new Request("http://localhost/api/endpoint");
    const res = await plugin.routes.fetch(req);
    expect(res.status).toBe(200);
  });
});
```

## Assertions Reference

```typescript
// Equality
expect(value).toBe(exact);           // === strict
expect(value).toEqual(deep);         // Deep equality
expect(value).toStrictEqual(deep);   // Deep + same types

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

// Arrays/Objects
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

## Best Practices

1. **One assertion focus per test** - Test one behavior at a time
2. **Descriptive names** - `it("should return 404 when user not found")`
3. **Arrange-Act-Assert** - Setup, execute, verify
4. **Clean up resources** - Use afterAll/afterEach for temp files
5. **Mock external dependencies** - Database, network, file system
6. **Test edge cases** - Empty arrays, null, undefined, errors
7. **Run tests before commits** - `bun test` in pre-commit workflow
