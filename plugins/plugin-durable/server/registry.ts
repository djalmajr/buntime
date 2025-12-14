import type { DurableObject, DurableObjectId, DurableObjectState } from "@buntime/durable";
import type { Client } from "@libsql/client/http";
import QuickLRU from "quick-lru";
import { DurableObjectStorage } from "./storage";

interface RegistryConfig {
  hibernateAfter: number;
  maxObjects: number;
}

interface ObjectEntry {
  className: string;
  id: DurableObjectId;
  instance: DurableObject;
  lastActive: number;
  queue: RequestQueue;
}

interface ObjectInfo {
  className: string;
  createdAt: number;
  id: string;
  lastActiveAt: number;
}

type DurableObjectClass = new (state: DurableObjectState) => DurableObject;

/**
 * Queue for serializing requests to a Durable Object
 */
class RequestQueue {
  private queue: Array<{
    request: Request;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }> = [];
  private processing = false;

  async enqueue(request: Request, handler: (req: Request) => Promise<Response>): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.process(handler);
    });
  }

  private async process(handler: (req: Request) => Promise<Response>): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const response = await handler(item.request);
        item.resolve(response);
      } catch (error) {
        item.reject(error as Error);
      }
    }

    this.processing = false;
  }
}

/**
 * Registry for managing Durable Object instances
 */
export class DurableObjectRegistry {
  private objects: QuickLRU<string, ObjectEntry>;
  private classes = new Map<string, DurableObjectClass>();
  private hibernationInterval: Timer | null = null;

  constructor(
    private client: Client,
    private config: RegistryConfig,
  ) {
    this.objects = new QuickLRU({ maxSize: config.maxObjects });
    this.startHibernationCheck();
  }

  /**
   * Register a Durable Object class
   */
  register(name: string, cls: DurableObjectClass): void {
    this.classes.set(name, cls);
  }

  /**
   * Get or create a Durable Object instance
   */
  async getOrCreate(
    className: string,
    id: DurableObjectId,
  ): Promise<{ fetch(request: Request): Promise<Response> }> {
    const key = `${className}:${id.toString()}`;

    let entry = this.objects.get(key);
    if (entry) {
      entry.lastActive = Date.now();
      return {
        fetch: (req: Request) => entry!.queue.enqueue(req, (r) => entry!.instance.fetch(r)),
      };
    }

    // Get or create the class
    const cls = this.classes.get(className);
    if (!cls) {
      throw new Error(`Unknown Durable Object class: ${className}`);
    }

    // Register in database if not exists
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO durable_objects (id, class_name) VALUES (?, ?)`,
      args: [id.toString(), className],
    });

    // Update last active
    await this.client.execute({
      sql: `UPDATE durable_objects SET last_active_at = unixepoch() WHERE id = ?`,
      args: [id.toString()],
    });

    // Create storage and state
    const storage = new DurableObjectStorage(this.client, id.toString());
    const state: DurableObjectState = {
      id,
      memory: new Map(),
      storage,
    };

    // Create instance
    const instance = new cls(state);
    await instance.init?.();

    entry = {
      className,
      id,
      instance,
      lastActive: Date.now(),
      queue: new RequestQueue(),
    };

    this.objects.set(key, entry);

    return {
      fetch: (req: Request) => entry!.queue.enqueue(req, (r) => entry!.instance.fetch(r)),
    };
  }

  /**
   * List all registered objects
   */
  async listAll(): Promise<ObjectInfo[]> {
    const result = await this.client.execute({
      sql: "SELECT id, class_name, created_at, last_active_at FROM durable_objects",
      args: [],
    });

    return result.rows.map((row) => ({
      className: row.class_name as string,
      createdAt: row.created_at as number,
      id: row.id as string,
      lastActiveAt: row.last_active_at as number,
    }));
  }

  /**
   * Get info about a specific object
   */
  async getInfo(id: string): Promise<ObjectInfo | null> {
    const result = await this.client.execute({
      sql: "SELECT id, class_name, created_at, last_active_at FROM durable_objects WHERE id = ?",
      args: [id],
    });

    const row = result.rows[0];
    if (!row) return null;

    return {
      className: row.class_name as string,
      createdAt: row.created_at as number,
      id: row.id as string,
      lastActiveAt: row.last_active_at as number,
    };
  }

  /**
   * Delete an object and its storage
   */
  async delete(id: string): Promise<boolean> {
    // Remove from memory
    for (const [key, entry] of this.objects) {
      if (entry.id.toString() === id) {
        await entry.instance.willHibernate?.();
        this.objects.delete(key);
        break;
      }
    }

    // Delete from database (cascade deletes storage)
    const result = await this.client.execute({
      sql: "DELETE FROM durable_objects WHERE id = ?",
      args: [id],
    });

    return result.rowsAffected > 0;
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    this.stopHibernationCheck();

    // Hibernate all objects
    for (const [, entry] of this.objects) {
      await entry.instance.willHibernate?.();
    }

    this.objects.clear();
  }

  private startHibernationCheck(): void {
    this.hibernationInterval = setInterval(async () => {
      const now = Date.now();

      for (const [key, entry] of this.objects) {
        if (now - entry.lastActive > this.config.hibernateAfter) {
          await entry.instance.willHibernate?.();
          this.objects.delete(key);
        }
      }
    }, 10_000);
  }

  private stopHibernationCheck(): void {
    if (this.hibernationInterval) {
      clearInterval(this.hibernationInterval);
      this.hibernationInterval = null;
    }
  }
}
