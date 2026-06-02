---
title: "@buntime/shared"
description: Shared types, error classes, logger, middleware, and utilities — published to JSR and used across the monorepo.
sidebar:
  order: 1
  label: "@buntime/shared"
---

`@buntime/shared` is the one package published outside the monorepo — to
[JSR](https://jsr.io/@buntime/shared). It holds the types, error classes,
logger, middleware, and utilities that the runtime, plugins, and apps all
depend on, so nothing is duplicated.

It uses **granular exports** rather than a single barrel: import exactly the
subpath you need.

## Installation

```bash
bunx jsr add @buntime/shared
```

Peer dependencies: `hono ^4`, `typescript ^5`, `zod ^4`.

## Exports

| Subpath | What it provides |
|---------|------------------|
| `@buntime/shared/types` | `BuntimePlugin`, `PluginImpl`, `PluginContext`, `AppInfo`, `WorkerManifest`, `WorkerConfig` |
| `@buntime/shared/errors` | `AppError` and the specific error classes (see below) |
| `@buntime/shared/logger/index` | `createLogger()`, `getLogger()`, child loggers (JSON in prod, pretty in dev) |
| `@buntime/shared/middleware/api-key` | `createApiKeyMiddleware()` — shared auth gate for plugin `/<base>/admin/**` routes |
| `@buntime/shared/api-keys` | API key store helpers |
| `@buntime/shared/turso` | Turso/libSQL client helpers |
| `@buntime/shared/build` | `createAppBuilder()` — the shared client/server build pipeline used by apps and plugins |
| `@buntime/shared/utils/worker-config` | `parseWorkerConfig()`, `WorkerConfigDefaults` |
| `@buntime/shared/utils/duration` | `parseDurationToMs()` — `"30s"`, `"1m"`, `"24h"` → ms |
| `@buntime/shared/utils/size` | `parseSizeToBytes()` — `"10mb"`, `"1gb"` → bytes |
| `@buntime/shared/utils/static-handler` | `createStaticHandler()` — serve a SPA dir with `<base href>` injection |
| `@buntime/shared/utils/glob` | glob matching for public-route patterns |
| `@buntime/shared/utils/zod-helpers` | shared Zod helpers (e.g. `boolean()`) |
| `@buntime/shared/utils/string` | string parsing helpers |
| `@buntime/shared/utils/buntime-config`, `@buntime/shared/utils/config-validation` | runtime config loading and validation |

## Error classes

Application code should **never throw a generic `Error`**. Use a specific class
from `@buntime/shared/errors`, always with a `SCREAMING_SNAKE_CASE` code that
clients can branch on:

```ts
import { ValidationError, NotFoundError } from "@buntime/shared/errors";

throw new ValidationError("Email is required", "MISSING_EMAIL");
throw new NotFoundError("User not found", "USER_NOT_FOUND");
// Client receives: { code: "MISSING_EMAIL", error: "Email is required" }
```

| Class | Typical status |
|-------|----------------|
| `ValidationError` | 400 |
| `UnauthorizedError` | 401 |
| `ForbiddenError` | 403 |
| `NotFoundError` | 404 |
| `BodyTooLargeError` | 413 |

Log full error details (with `requestId`, `userId`, stack) server-side, but keep
the message returned to the client user-friendly.

## Versioning

`@buntime/shared` is published **only** via the GitHub Actions OIDC workflow —
never manually from the CLI. The `jsr.json` and `package.json` versions must
always match. See [Publishing to JSR](/ops/jsr-publish/).

## Related

- [`@buntime/keyval`](/packages/keyval/) — the KV client library and modeling guide.
- [Plugin System](/concepts/plugin-system/) — where `PluginImpl`/`PluginContext` are used.
