import { describe, expect, it, mock } from "bun:test";
import type { DurableObjectId } from "@buntime/durable";
import { DurableObjectNamespace, DurableObjectStub } from "@buntime/durable";

/**
 * Creates a mock registry for testing
 */
const createMockRegistry = () => {
  const instances = new Map<string, { fetch: (req: Request) => Promise<Response> }>();

  return {
    getOrCreate: mock(async (className: string, id: DurableObjectId) => {
      const key = `${className}:${id.toString()}`;
      if (!instances.has(key)) {
        instances.set(key, {
          fetch: mock(async (_req: Request) => new Response("OK", { status: 200 })),
        });
      }
      return instances.get(key)!;
    }),
    instances,
  };
};

describe("DurableObjectNamespace", () => {
  describe("constructor", () => {
    it("should create namespace with registry and class name", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      expect(namespace).toBeDefined();
    });
  });

  describe("idFromName", () => {
    it("should create deterministic ID from name", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id1 = namespace.idFromName("my-counter");
      const id2 = namespace.idFromName("my-counter");

      expect(id1.toString()).toBe(id2.toString());
      expect(id1.name).toBe("my-counter");
      expect(id2.name).toBe("my-counter");
    });

    it("should create different IDs for different names", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id1 = namespace.idFromName("counter-1");
      const id2 = namespace.idFromName("counter-2");

      expect(id1.toString()).not.toBe(id2.toString());
    });

    it("should return ID with name property", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.idFromName("named-object");

      expect(id.name).toBe("named-object");
    });

    it("should handle empty string name", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.idFromName("");

      expect(id.toString()).toBeDefined();
      expect(id.name).toBe("");
    });

    it("should handle special characters in name", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.idFromName("user@example.com/path?query=1");

      expect(id.toString()).toBeDefined();
      expect(id.name).toBe("user@example.com/path?query=1");
    });

    it("should produce consistent hash for long strings", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const longName = "a".repeat(1000);
      const id1 = namespace.idFromName(longName);
      const id2 = namespace.idFromName(longName);

      expect(id1.toString()).toBe(id2.toString());
    });
  });

  describe("idFromString", () => {
    it("should parse ID from string representation", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.idFromString("abc123");

      expect(id.toString()).toBe("abc123");
    });

    it("should not have name property", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.idFromString("some-id");

      expect(id.name).toBeUndefined();
    });

    it("should handle UUID-like strings", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const id = namespace.idFromString(uuid);

      expect(id.toString()).toBe(uuid);
    });
  });

  describe("newUniqueId", () => {
    it("should generate unique ID", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.newUniqueId();

      expect(id.toString()).toBeDefined();
      expect(id.toString()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("should generate different IDs on each call", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id1 = namespace.newUniqueId();
      const id2 = namespace.newUniqueId();

      expect(id1.toString()).not.toBe(id2.toString());
    });

    it("should not have name property", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.newUniqueId();

      expect(id.name).toBeUndefined();
    });
  });

  describe("get", () => {
    it("should return a DurableObjectStub", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.idFromName("test");
      const stub = namespace.get(id);

      expect(stub).toBeInstanceOf(DurableObjectStub);
    });

    it("should pass correct ID to stub", () => {
      const mockRegistry = createMockRegistry();
      const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

      const id = namespace.idFromName("test-object");
      const stub = namespace.get(id);

      expect(stub.id.toString()).toBe(id.toString());
    });
  });
});

describe("DurableObjectStub", () => {
  describe("constructor", () => {
    it("should store ID reference", () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "test-id", name: "test" };

      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      expect(stub.id).toBe(id);
    });
  });

  describe("fetch", () => {
    it("should call registry.getOrCreate and fetch", async () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "fetch-test" };
      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      const request = new Request("http://localhost/test");
      const response = await stub.fetch(request);

      expect(mockRegistry.getOrCreate).toHaveBeenCalledWith("TestObject", id);
      expect(response.status).toBe(200);
    });

    it("should handle Request object directly", async () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "request-test" };
      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      const request = new Request("http://localhost/path", { method: "POST" });
      const response = await stub.fetch(request);

      expect(response.status).toBe(200);
    });

    it("should handle Request with init override", async () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "init-test" };
      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      const request = new Request("http://localhost/path", { method: "GET" });
      const response = await stub.fetch(request, { method: "POST" });

      expect(response.status).toBe(200);
    });

    it("should handle string URL", async () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "string-url-test" };
      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      const response = await stub.fetch("http://localhost/path");

      expect(response.status).toBe(200);
    });

    it("should handle string URL with init", async () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "string-init-test" };
      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      const response = await stub.fetch("http://localhost/path", {
        body: JSON.stringify({ data: "test" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(200);
    });

    it("should handle URL object", async () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "url-object-test" };
      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      const url = new URL("http://localhost/path?query=value");
      const response = await stub.fetch(url);

      expect(response.status).toBe(200);
    });

    it("should handle URL object with init", async () => {
      const mockRegistry = createMockRegistry();
      const id: DurableObjectId = { toString: () => "url-init-test" };
      const stub = new DurableObjectStub(mockRegistry as never, "TestObject", id);

      const url = new URL("http://localhost/path");
      const response = await stub.fetch(url, { method: "DELETE" });

      expect(response.status).toBe(200);
    });
  });
});

describe("hashString (via idFromName)", () => {
  it("should produce 8-character hex output", () => {
    const mockRegistry = createMockRegistry();
    const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

    const id = namespace.idFromName("test");

    expect(id.toString()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("should pad short hashes with zeros", () => {
    const mockRegistry = createMockRegistry();
    const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

    // Empty string should produce a padded result
    const id = namespace.idFromName("");

    expect(id.toString()).toHaveLength(8);
    expect(id.toString()).toBe("00000000");
  });

  it("should handle unicode characters", () => {
    const mockRegistry = createMockRegistry();
    const namespace = new DurableObjectNamespace(mockRegistry as never, "TestObject");

    const id1 = namespace.idFromName("\u{1F600}"); // emoji
    const id2 = namespace.idFromName("test");

    expect(id1.toString()).toMatch(/^[0-9a-f]{8}$/);
    expect(id1.toString()).not.toBe(id2.toString());
  });
});
