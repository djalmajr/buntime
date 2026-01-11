# @buntime/plugin-durable

Stateful actors plugin for Buntime runner (similar to Cloudflare Durable Objects).

## Features

- Singleton instances by ID
- Persistent storage via `@buntime/plugin-database`
- Request serialization (single-threaded execution)
- Automatic hibernation and wake-up
- LRU cache for active actors

## Requirements

Requires `@buntime/plugin-database` to be configured before this plugin.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/durable/` | List all actors |
| `GET /api/durable/:id` | Get actor info |
| `DELETE /api/durable/:id` | Delete actor |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxObjects` | `number` | `1000` | Max actors in memory |
| `hibernateAfter` | `number` | `60000` | Idle timeout before hibernation (ms) |

## Usage

### Server Configuration

Each plugin has its own `manifest.jsonc`:

```jsonc
// plugins/plugin-database/manifest.jsonc
{
  "enabled": true,
  "adapters": [{ "type": "libsql", "default": true }]
}
```

```jsonc
// plugins/plugin-durable/manifest.jsonc
{
  "enabled": true,
  "maxObjects": 500,
  "hibernateAfter": 30000
}
```

Environment variables:

```bash
LIBSQL_URL_0=http://localhost:8880  # Primary database
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
