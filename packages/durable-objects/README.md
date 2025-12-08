# @buntime/durable-objects

Cloudflare-like Durable Objects extension for Buntime server.

## Features

- Singleton instances by ID
- Persistent storage via libSQL
- Request serialization (single-threaded execution)
- Automatic hibernation and wake-up
- LRU cache for active objects

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /_/durable-objects/` | List all objects |
| `GET /_/durable-objects/:id` | Get object info |
| `DELETE /_/durable-objects/:id` | Delete object |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `libsqlUrl` | `string` | `"file:./durable-objects.db"` | libSQL database URL (supports `${ENV}`) |
| `libsqlToken` | `string` | - | libSQL auth token (supports `${ENV}`) |
| `maxObjects` | `number` | `1000` | Max objects in memory |
| `hibernateAfter` | `number` | `60000` | Idle timeout before hibernation (ms) |

## Usage

### Server Configuration

```typescript
// buntime.config.ts
export default {
  plugins: [
    ["@buntime/durable-objects", {
      libsqlUrl: "${LIBSQL_URL}",
      libsqlToken: "${LIBSQL_TOKEN}",
      maxObjects: 500,
      hibernateAfter: 30000,
    }],
  ],
}
```

### Client Usage (in workers)

See [@buntime/durable-objects-sdk](../durable-objects-sdk/README.md) for client-side usage.

```typescript
import { DurableObject } from "@buntime/durable-objects-sdk";

class Counter extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const count = await this.state.storage.get<number>("count") ?? 0;
    await this.state.storage.put("count", count + 1);
    return new Response(String(count + 1));
  }
}
```

## Priority

**25** - Manages Durable Object instances.

## Related

- [@buntime/durable-objects-sdk](../durable-objects-sdk/README.md) - Client SDK for workers
