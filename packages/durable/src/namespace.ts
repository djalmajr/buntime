import type { DurableObjectId } from "./types";

/**
 * Internal interface for the registry (provided by the extension)
 */
interface DurableObjectRegistry {
  getOrCreate(
    className: string,
    id: DurableObjectId,
  ): Promise<{
    fetch(request: Request): Promise<Response>;
  }>;
}

/**
 * Namespace for accessing Durable Objects of a specific class
 *
 * @example
 * ```typescript
 * // Get or create a Durable Object by name
 * const id = COUNTERS.idFromName("my-counter");
 * const stub = COUNTERS.get(id);
 * const response = await stub.fetch(request);
 * ```
 */
export class DurableObjectNamespace {
  /** @internal */
  constructor(
    private registry: DurableObjectRegistry,
    private className: string,
  ) {}

  /**
   * Create a deterministic ID from a name.
   * The same name always produces the same ID.
   */
  idFromName(name: string): DurableObjectId {
    const hash = this.hashString(name);
    return {
      toString: () => hash,
      name,
    };
  }

  /**
   * Parse an ID from its string representation.
   */
  idFromString(id: string): DurableObjectId {
    return {
      toString: () => id,
    };
  }

  /**
   * Generate a new unique ID.
   */
  newUniqueId(): DurableObjectId {
    const id = crypto.randomUUID();
    return {
      toString: () => id,
    };
  }

  /**
   * Get a stub for communicating with a Durable Object.
   */
  get(id: DurableObjectId): DurableObjectStub {
    return new DurableObjectStub(this.registry, this.className, id);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}

/**
 * Stub for communicating with a specific Durable Object instance
 */
export class DurableObjectStub {
  /** The ID of this Durable Object */
  readonly id: DurableObjectId;

  /** @internal */
  constructor(
    private registry: DurableObjectRegistry,
    private className: string,
    id: DurableObjectId,
  ) {
    this.id = id;
  }

  /**
   * Send a request to the Durable Object.
   * Requests are serialized - only one executes at a time.
   */
  async fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
    let request: Request;
    if (input instanceof Request) {
      request = init ? new Request(input, init) : input;
    } else {
      const url = input instanceof URL ? input.toString() : input;
      request = new Request(url, init);
    }
    const entry = await this.registry.getOrCreate(this.className, this.id);
    return entry.fetch(request);
  }
}
