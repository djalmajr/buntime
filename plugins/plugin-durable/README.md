# @buntime/plugin-durable

Stateful actors plugin for Buntime server (similar to Cloudflare Durable Objects).

## Features

- Singleton instances by ID
- Persistent storage via libSQL
- Request serialization (single-threaded execution)
- Automatic hibernation and wake-up
- LRU cache for active actors

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /_/plugin-durable/` | List all actors |
| `GET /_/plugin-durable/:id` | Get actor info |
| `DELETE /_/plugin-durable/:id` | Delete actor |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `libsqlUrl` | `string` | `"file:./durable.db"` | libSQL database URL (supports `${ENV}`) |
| `libsqlToken` | `string` | - | libSQL auth token (supports `${ENV}`) |
| `maxObjects` | `number` | `1000` | Max actors in memory |
| `hibernateAfter` | `number` | `60000` | Idle timeout before hibernation (ms) |

## Usage

### Server Configuration

```typescript
// buntime.config.ts
export default {
  plugins: [
    ["@buntime/plugin-durable", {
      libsqlUrl: "${LIBSQL_URL}",
      libsqlToken: "${LIBSQL_TOKEN}",
      maxObjects: 500,
      hibernateAfter: 30000,
    }],
  ],
}
```

### Client Usage (in workers)

See [@buntime/durable](../../packages/durable/README.md) for client-side usage.

```typescript
import { DurableObject } from "@buntime/durable";

class Counter extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const count = await this.state.storage.get<number>("count") ?? 0;
    await this.state.storage.put("count", count + 1);
    return new Response(String(count + 1));
  }
}
```

## Priority

**25** - Manages stateful actor instances.

## Related

- [@buntime/durable](../../packages/durable/README.md) - Client SDK for workers
