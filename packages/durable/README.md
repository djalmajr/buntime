# @buntime/durable

Client SDK for Durable actors in Buntime workers.

## Installation

```bash
bun add @buntime/durable
```

## Usage

### Creating a Durable Actor

```typescript
import { DurableObject, type DurableObjectState } from "@buntime/durable";

export class Counter extends DurableObject {
  constructor(state: DurableObjectState) {
    super(state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/increment") {
      const count = await this.state.storage.get<number>("count") ?? 0;
      await this.state.storage.put("count", count + 1);
      return new Response(String(count + 1));
    }

    if (url.pathname === "/get") {
      const count = await this.state.storage.get<number>("count") ?? 0;
      return new Response(String(count));
    }

    return new Response("Not Found", { status: 404 });
  }

  // Optional: called before hibernation
  async willHibernate(): Promise<void> {
    // Cleanup or save state
  }
}
```

### Accessing a Durable Actor

```typescript
import { DurableObjectNamespace } from "@buntime/durable";

// Get namespace (injected by Buntime)
const COUNTERS: DurableObjectNamespace = /* ... */;

// Get or create by name (deterministic ID)
const id = COUNTERS.idFromName("my-counter");
const stub = COUNTERS.get(id);

// Send request
const response = await stub.fetch(new Request("http://do/increment"));
const count = await response.text();
```

## API

### DurableObject

Base class for Durable actors.

```typescript
abstract class DurableObject {
  protected state: DurableObjectState;

  constructor(state: DurableObjectState);
  abstract fetch(request: Request): Promise<Response>;

  // Optional lifecycle hooks
  async init?(): Promise<void>;
  async willHibernate?(): Promise<void>;
}
```

### DurableObjectState

```typescript
interface DurableObjectState {
  id: DurableObjectId;
  storage: DurableObjectStorage;
  memory: Map<string, unknown>;  // In-memory cache (cleared on hibernation)
}
```

### DurableObjectStorage

```typescript
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  get<T>(keys: string[]): Promise<Map<string, T>>;

  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;

  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;

  list<T>(options?: ListOptions): Promise<Map<string, T>>;

  transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T>;
}

interface ListOptions {
  prefix?: string;
  start?: string;
  end?: string;
  limit?: number;
  reverse?: boolean;
}
```

### DurableObjectNamespace

```typescript
class DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
```

### DurableObjectStub

```typescript
class DurableObjectStub {
  readonly id: DurableObjectId;
  fetch(input: string | Request | URL, init?: RequestInit): Promise<Response>;
}
```

## Related

- [@buntime/plugin-durable](../plugins/durable/README.md) - Server plugin
