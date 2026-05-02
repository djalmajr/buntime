---
title: "Runtime logging system"
audience: ops
sources:
  - apps/runtime/docs/logging.md
  - apps/runtime/docs/security.md
updated: 2026-05-02
tags: [logging, observability]
status: stable
---

# Runtime logging system

> Core Buntime logging pipeline (`@buntime/shared/logger`): global singleton logger, per-context child loggers, transports (console pretty/json + file with buffer), log levels, and request ID correlation. Useful for diagnosing startup, plugins, workers, and traffic.

This page covers the **runtime logger** (in-memory, written to stdout/file). For the plugin that captures and exposes these logs via SSE/HTTP at `/logs`, see [`../apps/plugin-logs.md`](../apps/plugin-logs.md). For structured errors consumed by the logger, see [`../apps/packages.md`](../apps/packages.md).

## Architecture

The logger lives in `packages/shared/src/logger/` and is imported as `@buntime/shared/logger`:

```
packages/shared/src/logger/
├── index.ts          # singleton + reexports
├── logger.ts         # LoggerImpl + createLogger
├── types.ts          # Logger, LogLevel, LogEntry, LogTransport
└── transports/
    ├── console.ts    # ConsoleTransport (pretty/json + colors)
    └── file.ts       # FileTransport (buffer + flush)
```

## Core API

| Function | Use |
|----------|-----|
| `createLogger(config)` | Creates a new isolated instance |
| `getLogger()` | Returns the global logger (creates default if none exists) |
| `setLogger(logger)` | Sets the global logger |
| `getChildLogger(context)` | Creates a child with a context prefix |
| `initLogger(config)` | Initializes and sets as global |

```typescript
interface Logger {
  child(context: string): Logger;
  close(): Promise<void>;
  debug(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  flush(): Promise<void>;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}
```

## Runtime initialization

`apps/runtime/src/api.ts` initializes the singleton **before any other code that logs**:

```typescript
const logLevel = Bun.env.RUNTIME_LOG_LEVEL ||
  (NODE_ENV === "production" ? "info" : "debug");

const logger = createLogger({
  level: logLevel,
  format: NODE_ENV === "production" ? "json" : "pretty",
});
setLogger(logger);
```

Notes:

- In production: `json` (machine-readable, easy to parse by plugin-logs or Loki)
- In dev: `pretty` (colorized, with `[context]`)
- Default level is `info` in prod and `debug` in dev — `RUNTIME_LOG_LEVEL` overrides this

## Configuration

```typescript
interface LoggerConfig {
  level?: "debug" | "info" | "warn" | "error";
  format?: "pretty" | "json";
  colors?: boolean;
  transports?: ("console" | "file" | LogTransport)[];
  filePath?: string;  // required if "file" is in the list
}
```

| Environment variable | Effect |
|----------------------|--------|
| `RUNTIME_LOG_LEVEL=debug` | Sets the minimum level |
| `DEBUG=*` or `DEBUG=true` | Enables debug level |

## Levels

Severity order:

| Level | Priority | Typical use |
|-------|----------|-------------|
| `debug` | 0 | Internal detail (plugin dispatch, worker payload) |
| `info` | 1 | Normal operation (worker spawn, plugin loaded) |
| `warn` | 2 | Non-critical anomaly (sensitive env var blocked, body capped) |
| `error` | 3 | Error requiring attention (worker crash, plugin throw) |

The logger only emits records with priority ≥ the configured level:

```typescript
const logger = createLogger({ level: "warn" });
logger.debug("ignored");  // not emitted
logger.info("ignored");   // not emitted
logger.warn("appears");
logger.error("appears");
```

## Plugins receive a logger via `ctx.logger`

In the `onInit` hook, `PluginContext` provides a logger pre-configured with the plugin's prefix (e.g., `plugin:keyval`):

```typescript
let logger: PluginContext["logger"];

export default function createPlugin(config: Config): PluginImpl {
  return {
    onInit(ctx) {
      logger = ctx.logger;
      logger.info("Plugin initialized", { config });
    },
    async onRequest(req: Request) {
      logger.debug("Processing request", { url: req.url });
      return req;
    },
  };
}
```

Outside `onInit` or in standalone scripts, use `getChildLogger("plugin:foo")` — if the singleton has not been initialized yet, it creates a default console logger.

## Transports

### ConsoleTransport

Writes to stdout/stderr.

#### Pretty (dev)

```
12:34:56.789 INF [plugin:keyval] Request processed {"duration":45}
12:34:56.790 ERR [plugin:keyval] Failed to connect {"error":"timeout"}
```

#### JSON (production)

```json
{"level":"info","message":"Request processed","time":"2024-01-15T12:34:56.789Z","context":"plugin:keyval","duration":45}
```

### FileTransport

Persists to a file with buffer + flush:

```typescript
new FileTransport({
  path: "/var/log/buntime.log",
  bufferSize: 100,      // flush after accumulating 100 entries
  flushInterval: 5000,  // flush every 5s
});
```

Useful on VMs/systemd. In K8s pods, stdout is usually sufficient — the cluster captures logs via `kubectl logs`. For persistent retention in a pod, use Loki/Elasticsearch via DaemonSet, not FileTransport (PVC becomes a bottleneck).

## Child loggers

Children inherit config and accumulate context:

```typescript
const logger = createLogger({ level: "debug" });
const childA = logger.child("moduleA");
const childB = childA.child("submodule");

childB.info("Hello");
// → ... [moduleA:submodule] Hello
```

Useful for prefixing each subsystem (worker pool, plugin loader, request handler) without repeating metadata in every call.

## Request ID correlation

The runtime generates/propagates an `X-Request-Id` per request:

| Header | Direction | Behavior |
|--------|-----------|----------|
| `X-Request-Id` | Request | Client may provide (optional) |
| `X-Request-Id` | Response | Always present (auto-generated via `crypto.randomUUID()` if absent) |

The ID is included in:

- Log entries (all levels)
- Error responses
- Worker requests (passed to the wrapper via internal header)
- `PluginContext.requestId` in hooks

```bash
# Client sends ID
curl -H "X-Request-Id: abc-123" http://localhost:8000/api/health
# Response includes the same ID
HTTP/1.1 200 OK
X-Request-Id: abc-123
```

Validation details and errors related to request ID in [Security](./security.md#request-id-correlation).

## Best practices

### DO

- Use `ctx.logger` in plugins (comes pre-configured with context)
- Include structured metadata — makes filtering/aggregation easier
- Use child loggers for subsystems
- In production, use `json` so downstream tools can parse it

```typescript
logger.info("User created", { userId: 123, email: "user@example.com" });
```

### DON'T

- Do not use `console.log` directly (bypasses the pipeline, no level, no context)
- Do not log sensitive data (passwords, tokens, JWTs, API keys) — some patterns are blocked in the worker environment but the logger has no filter
- Do not log in tight loops at `info` — use `debug`

```typescript
// WRONG
console.log("User created:", user);

// CORRECT
logger.info("User created", { userId: user.id });
```

## Cross-refs

- **Logs persisted via plugin** (ring buffer + SSE at `/logs`): [`../apps/plugin-logs.md`](../apps/plugin-logs.md)
- **Structured errors** (`ValidationError`, `NotFoundError`, etc.): [`../apps/packages.md`](../apps/packages.md)
- **Sensitive env var filtering in workers**: [Security](./security.md#sensitive-env-var-filtering)
- **Prometheus metrics**: [`../apps/plugin-metrics.md`](../apps/plugin-metrics.md)
