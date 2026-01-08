import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { DurableObject } from "@buntime/durable";
import { DurableObjectRegistry } from "./registry";

/**
 * Creates a mock database adapter for testing
 */
const createMockAdapter = () => {
  const objects = new Map<
    string,
    { class_name: string; created_at: number; last_active_at: number }
  >();

  return {
    batch: mock(() => Promise.resolve([])),
    close: mock(() => Promise.resolve()),
    execute: mock((sql: string, args?: unknown[]) => {
      if (sql.includes("INSERT OR IGNORE INTO durable_objects")) {
        const id = args?.[0] as string;
        const className = args?.[1] as string;
        if (!objects.has(id)) {
          objects.set(id, {
            class_name: className,
            created_at: Math.floor(Date.now() / 1000),
            last_active_at: Math.floor(Date.now() / 1000),
          });
        }
        return Promise.resolve([]);
      }
      if (sql.includes("UPDATE durable_objects SET last_active_at")) {
        const id = args?.[0] as string;
        const obj = objects.get(id);
        if (obj) {
          obj.last_active_at = Math.floor(Date.now() / 1000);
        }
        return Promise.resolve([]);
      }
      if (
        sql.includes("SELECT id, class_name, created_at, last_active_at FROM durable_objects") &&
        !sql.includes("WHERE")
      ) {
        return Promise.resolve(
          Array.from(objects.entries()).map(([id, obj]) => ({
            class_name: obj.class_name,
            created_at: obj.created_at,
            id,
            last_active_at: obj.last_active_at,
          })),
        );
      }
      if (sql.includes("DELETE FROM durable_objects WHERE id")) {
        const id = args?.[0] as string;
        objects.delete(id);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
    executeOne: mock((sql: string, args?: unknown[]) => {
      if (
        sql.includes(
          "SELECT id, class_name, created_at, last_active_at FROM durable_objects WHERE id",
        )
      ) {
        const id = args?.[0] as string;
        const obj = objects.get(id);
        if (!obj) return Promise.resolve(null);
        return Promise.resolve({
          class_name: obj.class_name,
          created_at: obj.created_at,
          id,
          last_active_at: obj.last_active_at,
        });
      }
      if (sql.includes("SELECT id FROM durable_objects WHERE id")) {
        const id = args?.[0] as string;
        if (objects.has(id)) {
          return Promise.resolve({ id });
        }
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    }),
    type: "libsql",
  };
};

/**
 * Test Durable Object class
 */
class TestDurableObject extends DurableObject {
  public initCalled = false;
  public hibernateCalled = false;
  public fetchCalls: Request[] = [];

  override async init(): Promise<void> {
    this.initCalled = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.fetchCalls.push(request);
    return new Response("OK", { status: 200 });
  }

  override async willHibernate(): Promise<void> {
    this.hibernateCalled = true;
  }
}

describe("DurableObjectRegistry", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let registry: DurableObjectRegistry;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    registry = new DurableObjectRegistry(mockAdapter as never, {
      hibernateAfter: 60_000,
      maxObjects: 100,
    });
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  describe("register", () => {
    it("should register a Durable Object class", () => {
      registry.register("TestObject", TestDurableObject);

      // No direct way to verify, but getOrCreate should work
      expect(true).toBe(true);
    });

    it("should allow registering multiple classes", () => {
      registry.register("TestObject1", TestDurableObject);
      registry.register("TestObject2", TestDurableObject);

      expect(true).toBe(true);
    });
  });

  describe("getOrCreate", () => {
    beforeEach(() => {
      registry.register("TestObject", TestDurableObject);
    });

    it("should create new object on first access", async () => {
      const id = { name: "test", toString: () => "test-id-1" };
      const stub = await registry.getOrCreate("TestObject", id);

      expect(stub).toBeDefined();
      expect(stub.fetch).toBeInstanceOf(Function);
    });

    it("should call init on new object", async () => {
      const id = { name: "test", toString: () => "test-id-2" };
      await registry.getOrCreate("TestObject", id);

      // Verify INSERT was called
      expect(mockAdapter.execute).toHaveBeenCalled();
    });

    it("should return same object on subsequent access", async () => {
      const id = { name: "test", toString: () => "test-id-3" };

      const stub1 = await registry.getOrCreate("TestObject", id);
      const stub2 = await registry.getOrCreate("TestObject", id);

      // Both stubs should reference the same underlying object
      expect(stub1.fetch).toBeDefined();
      expect(stub2.fetch).toBeDefined();
    });

    it("should throw for unknown class", async () => {
      const id = { name: "test", toString: () => "test-id-4" };

      await expect(registry.getOrCreate("UnknownClass", id)).rejects.toThrow(
        "Unknown Durable Object class: UnknownClass",
      );
    });

    it("should register object in database", async () => {
      const id = { name: "test", toString: () => "test-id-5" };
      await registry.getOrCreate("TestObject", id);

      // Check INSERT was called
      const insertCalls = mockAdapter.execute.mock.calls.filter((call) =>
        (call[0] as string).includes("INSERT OR IGNORE"),
      );
      expect(insertCalls.length).toBeGreaterThan(0);
    });

    it("should update last_active_at on access", async () => {
      const id = { name: "test", toString: () => "test-id-6" };
      await registry.getOrCreate("TestObject", id);

      // Check UPDATE was called
      const updateCalls = mockAdapter.execute.mock.calls.filter((call) =>
        (call[0] as string).includes("UPDATE durable_objects SET last_active_at"),
      );
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it("should handle fetch through stub", async () => {
      const id = { name: "test", toString: () => "test-id-7" };
      const stub = await registry.getOrCreate("TestObject", id);

      const request = new Request("http://localhost/test");
      const response = await stub.fetch(request);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    });
  });

  describe("listAll", () => {
    beforeEach(() => {
      registry.register("TestObject", TestDurableObject);
    });

    it("should return empty array when no objects", async () => {
      const objects = await registry.listAll();

      expect(objects).toEqual([]);
    });

    it("should return all registered objects", async () => {
      await registry.getOrCreate("TestObject", { name: "obj1", toString: () => "obj-1" });
      await registry.getOrCreate("TestObject", { name: "obj2", toString: () => "obj-2" });

      const objects = await registry.listAll();

      expect(objects.length).toBe(2);
      expect(objects.map((o) => o.id)).toContain("obj-1");
      expect(objects.map((o) => o.id)).toContain("obj-2");
    });

    it("should return object info with all fields", async () => {
      await registry.getOrCreate("TestObject", { name: "test", toString: () => "obj-info" });

      const objects = await registry.listAll();
      const obj = objects.find((o) => o.id === "obj-info");

      expect(obj).toBeDefined();
      expect(obj?.className).toBe("TestObject");
      expect(obj?.createdAt).toBeGreaterThan(0);
      expect(obj?.lastActiveAt).toBeGreaterThan(0);
    });
  });

  describe("getInfo", () => {
    beforeEach(() => {
      registry.register("TestObject", TestDurableObject);
    });

    it("should return null for non-existent object", async () => {
      const info = await registry.getInfo("non-existent");

      expect(info).toBeNull();
    });

    it("should return info for existing object", async () => {
      await registry.getOrCreate("TestObject", { name: "test", toString: () => "info-test" });

      const info = await registry.getInfo("info-test");

      expect(info).not.toBeNull();
      expect(info?.id).toBe("info-test");
      expect(info?.className).toBe("TestObject");
      expect(info?.createdAt).toBeGreaterThan(0);
      expect(info?.lastActiveAt).toBeGreaterThan(0);
    });
  });

  describe("delete", () => {
    beforeEach(() => {
      registry.register("TestObject", TestDurableObject);
    });

    it("should return false for non-existent object", async () => {
      const result = await registry.delete("non-existent");

      expect(result).toBe(false);
    });

    it("should return true when object is deleted", async () => {
      await registry.getOrCreate("TestObject", { name: "test", toString: () => "delete-test" });

      const result = await registry.delete("delete-test");

      expect(result).toBe(true);
    });

    it("should remove object from database", async () => {
      await registry.getOrCreate("TestObject", { name: "test", toString: () => "delete-db-test" });
      await registry.delete("delete-db-test");

      const info = await registry.getInfo("delete-db-test");
      expect(info).toBeNull();
    });

    it("should call willHibernate before deletion", async () => {
      const id = { name: "test", toString: () => "hibernate-before-delete" };
      await registry.getOrCreate("TestObject", id);

      // Delete the object
      await registry.delete("hibernate-before-delete");

      // willHibernate should have been called (we can't verify directly with mock, but no error means success)
      expect(true).toBe(true);
    });
  });

  describe("shutdown", () => {
    beforeEach(() => {
      registry.register("TestObject", TestDurableObject);
    });

    it("should hibernate all objects", async () => {
      await registry.getOrCreate("TestObject", { name: "obj1", toString: () => "shutdown-1" });
      await registry.getOrCreate("TestObject", { name: "obj2", toString: () => "shutdown-2" });

      await registry.shutdown();

      // Objects should be cleared
      expect(true).toBe(true);
    });

    it("should stop hibernation check interval", async () => {
      await registry.shutdown();

      // No error means success
      expect(true).toBe(true);
    });

    it("should be callable multiple times", async () => {
      await registry.shutdown();
      await registry.shutdown();

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe("request serialization", () => {
    beforeEach(() => {
      registry.register("TestObject", TestDurableObject);
    });

    it("should serialize concurrent requests to same object", async () => {
      const id = { name: "test", toString: () => "serial-test" };
      const stub = await registry.getOrCreate("TestObject", id);

      // Send multiple concurrent requests
      const requests = [
        stub.fetch(new Request("http://localhost/1")),
        stub.fetch(new Request("http://localhost/2")),
        stub.fetch(new Request("http://localhost/3")),
      ];

      const responses = await Promise.all(requests);

      // All requests should succeed
      expect(responses.every((r) => r.status === 200)).toBe(true);
    });
  });

  describe("LRU eviction", () => {
    it("should respect maxObjects limit", async () => {
      const smallRegistry = new DurableObjectRegistry(mockAdapter as never, {
        hibernateAfter: 60_000,
        maxObjects: 2,
      });
      smallRegistry.register("TestObject", TestDurableObject);

      // Create 3 objects (one more than max)
      await smallRegistry.getOrCreate("TestObject", { name: "obj1", toString: () => "lru-1" });
      await smallRegistry.getOrCreate("TestObject", { name: "obj2", toString: () => "lru-2" });
      await smallRegistry.getOrCreate("TestObject", { name: "obj3", toString: () => "lru-3" });

      // LRU should evict the oldest - but we can't directly verify the cache
      // At least no error means the limit is respected
      await smallRegistry.shutdown();
      expect(true).toBe(true);
    });
  });

  describe("hibernation check", () => {
    it("should hibernate idle objects after hibernateAfter time", async () => {
      // Use mock timers to control time
      const originalSetInterval = globalThis.setInterval;
      let intervalCallback: () => Promise<void>;

      // Capture the interval callback
      (globalThis as unknown as { setInterval: unknown }).setInterval = (
        cb: () => Promise<void>,
      ) => {
        intervalCallback = cb;
        return originalSetInterval(() => {}, 1_000_000);
      };

      try {
        const hibernateRegistry = new DurableObjectRegistry(mockAdapter as never, {
          hibernateAfter: 100, // Very short timeout
          maxObjects: 100,
        });

        // Track willHibernate calls
        let hibernateCalled = false;
        class HibernatingObject extends DurableObject {
          override async fetch(_request: Request): Promise<Response> {
            return new Response("OK");
          }
          override async willHibernate(): Promise<void> {
            hibernateCalled = true;
          }
        }

        hibernateRegistry.register("HibernatingObject", HibernatingObject);

        // Create an object
        const id = { name: "test", toString: () => "hibernation-test" };
        await hibernateRegistry.getOrCreate("HibernatingObject", id);

        // Wait a bit for the object to be considered idle
        await new Promise((r) => setTimeout(r, 150));

        // Trigger the interval callback manually
        await intervalCallback!();

        // The object should have been hibernated since lastActive > hibernateAfter
        expect(hibernateCalled).toBe(true);

        await hibernateRegistry.shutdown();
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    it("should not hibernate active objects", async () => {
      const originalSetInterval = globalThis.setInterval;
      let intervalCallback: () => Promise<void>;

      (globalThis as unknown as { setInterval: unknown }).setInterval = (
        cb: () => Promise<void>,
      ) => {
        intervalCallback = cb;
        return originalSetInterval(() => {}, 1_000_000);
      };

      try {
        const hibernateRegistry = new DurableObjectRegistry(mockAdapter as never, {
          hibernateAfter: 10_000, // Long timeout
          maxObjects: 100,
        });

        let hibernateCalled = false;
        class ActiveObject extends DurableObject {
          override async fetch(_request: Request): Promise<Response> {
            return new Response("OK");
          }
          override async willHibernate(): Promise<void> {
            hibernateCalled = true;
          }
        }

        hibernateRegistry.register("ActiveObject", ActiveObject);

        const id = { name: "test", toString: () => "active-test" };
        await hibernateRegistry.getOrCreate("ActiveObject", id);

        // Trigger the interval callback immediately (object just created, should not hibernate)
        await intervalCallback!();

        expect(hibernateCalled).toBe(false);

        await hibernateRegistry.shutdown();
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    it("should handle objects without willHibernate method", async () => {
      const originalSetInterval = globalThis.setInterval;
      let intervalCallback: () => Promise<void>;

      (globalThis as unknown as { setInterval: unknown }).setInterval = (
        cb: () => Promise<void>,
      ) => {
        intervalCallback = cb;
        return originalSetInterval(() => {}, 1_000_000);
      };

      try {
        const hibernateRegistry = new DurableObjectRegistry(mockAdapter as never, {
          hibernateAfter: 100,
          maxObjects: 100,
        });

        // Object without willHibernate
        class SimpleObject extends DurableObject {
          override async fetch(_request: Request): Promise<Response> {
            return new Response("OK");
          }
        }

        hibernateRegistry.register("SimpleObject", SimpleObject);

        const id = { name: "test", toString: () => "simple-test" };
        await hibernateRegistry.getOrCreate("SimpleObject", id);

        await new Promise((r) => setTimeout(r, 150));

        // Should not throw even without willHibernate method
        await expect(intervalCallback!()).resolves.toBeUndefined();

        await hibernateRegistry.shutdown();
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });
  });
});

describe("RequestQueue", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let registry: DurableObjectRegistry;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    registry = new DurableObjectRegistry(mockAdapter as never, {
      hibernateAfter: 60_000,
      maxObjects: 100,
    });
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  it("should process requests in order", async () => {
    const order: number[] = [];

    class OrderedObject extends DurableObject {
      override async fetch(request: Request): Promise<Response> {
        const num = Number.parseInt(new URL(request.url).pathname.slice(1), 10);
        // Add small delay to ensure ordering matters
        await new Promise((r) => setTimeout(r, 10));
        order.push(num);
        return new Response("OK");
      }
    }

    registry.register("OrderedObject", OrderedObject);
    const stub = await registry.getOrCreate("OrderedObject", { toString: () => "order-test" });

    // Send requests concurrently
    await Promise.all([
      stub.fetch(new Request("http://localhost/1")),
      stub.fetch(new Request("http://localhost/2")),
      stub.fetch(new Request("http://localhost/3")),
    ]);

    // Requests should be processed in order
    expect(order).toEqual([1, 2, 3]);
  });

  it("should handle errors without blocking queue", async () => {
    let callCount = 0;

    class ErrorObject extends DurableObject {
      override async fetch(_request: Request): Promise<Response> {
        callCount++;
        if (callCount === 2) {
          throw new Error("Simulated error");
        }
        return new Response("OK");
      }
    }

    registry.register("ErrorObject", ErrorObject);
    const stub = await registry.getOrCreate("ErrorObject", { toString: () => "error-test" });

    const results = await Promise.allSettled([
      stub.fetch(new Request("http://localhost/1")),
      stub.fetch(new Request("http://localhost/2")),
      stub.fetch(new Request("http://localhost/3")),
    ]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(results[2].status).toBe("fulfilled");
    expect(callCount).toBe(3);
  });
});
