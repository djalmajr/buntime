# Logging

Buntime's logging system is centralized in the `@buntime/shared/logger` package.

## Architecture

```
packages/shared/src/logger/      # Import as @buntime/shared/logger
├── index.ts                     # Singleton + exports
├── types.ts                     # Logger, LogLevel, LogEntry, LogTransport
├── logger.ts                    # LoggerImpl + createLogger
└── transports/
    ├── console.ts               # ConsoleTransport (pretty/json)
    └── file.ts                  # FileTransport (buffer + flush)
```

## API

### Main Functions

| Function | Description |
|----------|-------------|
| `createLogger(config)` | Creates a new logger instance |
| `getLogger()` | Gets the global logger (creates default if doesn't exist) |
| `setLogger(logger)` | Sets the global logger |
| `getChildLogger(context)` | Creates child logger with context prefix |
| `initLogger(config)` | Initializes and sets the global logger |

### Logger Interface

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

### Configuration

```typescript
interface LoggerConfig {
  level?: "debug" | "info" | "warn" | "error";  // default: "info" or RUNTIME_LOG_LEVEL env
  format?: "pretty" | "json";                    // default: "pretty"
  colors?: boolean;                              // default: auto-detect TTY
  transports?: ("console" | "file" | LogTransport)[];
  filePath?: string;                             // required if using "file"
}
```

## Usage in Runtime

The runner initializes the global logger at process start:

```typescript
// apps/runtime/src/api.ts
import { createLogger, setLogger } from "@buntime/shared/logger";

const logLevel = Bun.env.RUNTIME_LOG_LEVEL ||
  (NODE_ENV === "production" ? "info" : "debug");

const logger = createLogger({
  level: logLevel,
  format: NODE_ENV === "production" ? "json" : "pretty",
});
setLogger(logger);
```

> [!IMPORTANT]
> The logger must be initialized before any other code that uses logging.

## Usage in Plugins

Plugins receive a logger via `ctx.logger` in the `onInit` hook:

```typescript
// plugins/plugin-example/plugin.ts
import type { PluginImpl, PluginContext } from "@buntime/shared/types";

let logger: PluginContext["logger"];

export default function createPlugin(config: Config): PluginImpl {
  return {
    onInit(ctx: PluginContext) {
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

The `ctx.logger` comes pre-configured with the plugin context (e.g., `plugin:example`).

### Fallback

If a plugin needs a logger before `onInit` or in standalone context, it can use `getChildLogger`:

```typescript
import { getChildLogger } from "@buntime/shared/logger";

const logger = getChildLogger("plugin:example");
```

> [!NOTE]
> If the runner hasn't initialized the global logger yet, `getChildLogger` creates a default console logger.

## Log Levels

Levels follow severity order:

| Level | Priority | Usage |
|-------|----------|-------|
| `debug` | 0 | Detailed information for debugging |
| `info` | 1 | Normal operation events |
| `warn` | 2 | Abnormal but non-critical situations |
| `error` | 3 | Errors that need attention |

### Level Filtering

The logger only emits logs with priority >= configured level:

```typescript
const logger = createLogger({ level: "warn" });
logger.debug("ignored");  // doesn't appear
logger.info("ignored");   // doesn't appear
logger.warn("appears");   // appears
logger.error("appears");  // appears
```

### Environment Variables

| Variable | Effect |
|----------|--------|
| `RUNTIME_LOG_LEVEL=debug` | Sets minimum log level |
| `DEBUG=*` or `DEBUG=true` | Activates debug level |

## Transports

### ConsoleTransport

Output to stdout/stderr with color and format support.

```typescript
import { ConsoleTransport } from "@buntime/shared/logger";

const transport = new ConsoleTransport({
  format: "pretty",  // or "json"
  colors: true,
});
```

#### Pretty Format

```
12:34:56.789 INF [plugin:keyval] Request processed {"duration":45}
12:34:56.790 ERR [plugin:keyval] Failed to connect {"error":"timeout"}
```

#### JSON Format

```json
{"level":"info","message":"Request processed","time":"2024-01-15T12:34:56.789Z","context":"plugin:keyval","duration":45}
```

### FileTransport

Writes logs to file with buffering for performance.

```typescript
import { FileTransport } from "@buntime/shared/logger";

const transport = new FileTransport({
  path: "/var/log/buntime.log",
  bufferSize: 100,      // flush after 100 entries
  flushInterval: 5000,  // flush every 5 seconds
});
```

## Child Loggers

Child loggers inherit configuration but add context:

```typescript
const logger = createLogger({ level: "debug" });
const childA = logger.child("moduleA");
const childB = childA.child("submodule");

childB.info("Hello");
// Output: ... [moduleA:submodule] Hello
```

## Best Practices

### DO

- Use `ctx.logger` in plugins
- Use appropriate levels (debug for dev, info for prod)
- Include structured metadata
- Use child loggers for context

```typescript
logger.info("User created", { userId: 123, email: "user@example.com" });
```

### DON'T

- Don't use `console.log` directly
- Don't log sensitive data (passwords, tokens)
- Don't log in tight loops (use debug + appropriate level)

```typescript
// WRONG
console.log("User created:", user);

// CORRECT
logger.info("User created", { userId: user.id });
```
