import type { DurableObjectState } from "./types";

/**
 * Base class for Durable Objects
 *
 * Extend this class to create your own Durable Objects with:
 * - Persistent storage
 * - In-memory state between requests
 * - Request serialization (single-threaded execution)
 *
 * @example
 * ```typescript
 * export class Counter extends DurableObject {
 *   private count = 0;
 *
 *   async init() {
 *     this.count = await this.state.storage.get("count") ?? 0;
 *   }
 *
 *   async fetch(request: Request) {
 *     if (request.method === "POST") {
 *       this.count++;
 *       await this.state.storage.put("count", this.count);
 *     }
 *     return Response.json({ count: this.count });
 *   }
 * }
 * ```
 */
export abstract class DurableObject {
  protected state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Called once when the object is first created or woken from hibernation.
   * Use this to load state from storage.
   */
  async init?(): Promise<void>;

  /**
   * Handle incoming HTTP requests.
   * This is the main entry point for your Durable Object.
   */
  abstract fetch(request: Request): Promise<Response>;

  /**
   * Called before the object hibernates.
   * Use this to clean up resources (e.g., close WebSocket connections).
   */
  async willHibernate?(): Promise<void>;
}
