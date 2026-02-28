# @buntime/shared

Shared types, utilities, and error classes for the Buntime plugin runtime.

## Installation

```bash
bunx jsr add @buntime/shared
```

## Usage

### Types

```typescript
import type { BuntimePlugin, PluginContext, PluginImpl } from "@buntime/shared/types";
import type { WorkerConfig, WorkerManifest } from "@buntime/shared/types";
```

### Error Classes

```typescript
import { NotFoundError, ValidationError } from "@buntime/shared/errors";

throw new ValidationError("Email is required", "MISSING_EMAIL");
throw new NotFoundError("User not found", "USER_NOT_FOUND");
```

### Logger

```typescript
import { createLogger, getLogger } from "@buntime/shared/logger";

const logger = createLogger({ level: "debug" });
logger.info("Hello from plugin");
```

### Utilities

```typescript
import { parseDurationToMs } from "@buntime/shared/utils/duration";
import { parseSizeToBytes } from "@buntime/shared/utils/size";
import { splitList } from "@buntime/shared/utils/string";
import { globToRegex } from "@buntime/shared/utils/glob";

parseDurationToMs("30s"); // 30000
parseSizeToBytes("10mb"); // 10485760
splitList("a, b, c");     // ["a", "b", "c"]
```

## Exports

| Export | Description |
|--------|-------------|
| `./types` | Plugin, worker, and configuration type definitions |
| `./errors` | HTTP error classes (`AppError`, `ValidationError`, `NotFoundError`, etc.) |
| `./logger` | Structured logger with console and file transports |
| `./utils/duration` | Parse duration strings to milliseconds |
| `./utils/size` | Parse size strings to bytes |
| `./utils/string` | String splitting and list utilities |
| `./utils/glob` | Glob-to-regex conversion for route matching |
| `./utils/buntime-config` | Manifest and `.env` file loaders |
| `./utils/config-validation` | Worker configuration validation |
| `./utils/worker-config` | Worker config types, defaults, and parser |
| `./utils/static-handler` | Static file handler with SPA fallback |

## License

See [LICENSE](../../LICENSE) for details.
