import { beforeEach, describe, expect, it } from "bun:test";
import { ResponseCache } from "./cache";

function createRequest(options: { method?: string; search?: string; url?: string }): Request {
  const url = options.url ?? `http://localhost:8000/api/test${options.search ?? ""}`;
  return new Request(url, { method: options.method ?? "GET" });
}

function createResponse(body: unknown, options?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...options,
  });
}

describe("ResponseCache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache(100);
  });

  describe("getKey", () => {
    it("should generate key from method and pathname", () => {
      const req = createRequest({});

      const key = cache.getKey(req);

      expect(key).toBe("GET:/api/test");
    });

    it("should include query string in key", () => {
      const req = createRequest({ search: "?page=1&limit=10" });

      const key = cache.getKey(req);

      expect(key).toBe("GET:/api/test?page=1&limit=10");
    });

    it("should differentiate keys by HTTP method", () => {
      const getReq = createRequest({ method: "GET" });
      const postReq = createRequest({ method: "POST" });

      expect(cache.getKey(getReq)).toBe("GET:/api/test");
      expect(cache.getKey(postReq)).toBe("POST:/api/test");
    });

    it("should differentiate keys by pathname", () => {
      const req1 = createRequest({ url: "http://localhost/users" });
      const req2 = createRequest({ url: "http://localhost/products" });

      expect(cache.getKey(req1)).toBe("GET:/users");
      expect(cache.getKey(req2)).toBe("GET:/products");
    });
  });

  describe("isCacheable", () => {
    it("should return true for allowed methods", () => {
      const req = createRequest({ method: "GET" });

      expect(cache.isCacheable(req, ["GET", "HEAD"])).toBe(true);
    });

    it("should return false for disallowed methods", () => {
      const req = createRequest({ method: "POST" });

      expect(cache.isCacheable(req, ["GET"])).toBe(false);
    });

    it("should be case insensitive", () => {
      const req = createRequest({ method: "GET" });

      expect(cache.isCacheable(req, ["get"])).toBe(false); // Method comes uppercase
    });

    it("should check multiple methods", () => {
      const getReq = createRequest({ method: "GET" });
      const headReq = createRequest({ method: "HEAD" });
      const postReq = createRequest({ method: "POST" });

      const methods = ["GET", "HEAD"];

      expect(cache.isCacheable(getReq, methods)).toBe(true);
      expect(cache.isCacheable(headReq, methods)).toBe(true);
      expect(cache.isCacheable(postReq, methods)).toBe(false);
    });
  });

  describe("set and get", () => {
    it("should store and retrieve response", async () => {
      const key = "GET:/api/data";
      const body = { message: "hello" };
      const response = createResponse(body);

      await cache.set(key, response, 60);
      const cached = cache.get(key);

      expect(cached).not.toBeNull();
      expect(cached!.status).toBe(200);

      const cachedBody = await cached!.json();
      expect(cachedBody).toEqual(body);
    });

    it("should set X-Cache header to MISS on stored response", async () => {
      const key = "GET:/api/data";
      const response = createResponse({ data: "test" });

      const storedResponse = await cache.set(key, response, 60);

      expect(storedResponse.headers.get("X-Cache")).toBe("MISS");
    });

    it("should set X-Cache header to HIT on retrieved response", async () => {
      const key = "GET:/api/data";
      const response = createResponse({ data: "test" });

      await cache.set(key, response, 60);
      const cached = cache.get(key);

      expect(cached!.headers.get("X-Cache")).toBe("HIT");
    });

    it("should preserve response headers", async () => {
      const key = "GET:/api/data";
      const response = new Response("test", {
        headers: {
          "Content-Type": "text/plain",
          "X-Custom-Header": "custom-value",
        },
        status: 200,
      });

      await cache.set(key, response, 60);
      const cached = cache.get(key);

      expect(cached!.headers.get("Content-Type")).toBe("text/plain");
      expect(cached!.headers.get("X-Custom-Header")).toBe("custom-value");
    });

    it("should preserve response status and statusText", async () => {
      const key = "GET:/api/created";
      const response = new Response("Created", {
        status: 201,
        statusText: "Created",
      });

      await cache.set(key, response, 60);
      const cached = cache.get(key);

      expect(cached!.status).toBe(201);
      expect(cached!.statusText).toBe("Created");
    });

    it("should return null for non-existent key", () => {
      const cached = cache.get("non-existent");

      expect(cached).toBeNull();
    });
  });

  describe("TTL expiration", () => {
    it("should return null for expired entries", async () => {
      const key = "GET:/api/expiring";
      const response = createResponse({ data: "test" });

      // Set with very short TTL
      await cache.set(key, response, 0.05); // 50ms

      // Wait for expiration
      await Bun.sleep(100);

      const cached = cache.get(key);
      expect(cached).toBeNull();
    });

    it("should return response before expiration", async () => {
      const key = "GET:/api/fresh";
      const response = createResponse({ data: "test" });

      await cache.set(key, response, 60); // 60 seconds

      const cached = cache.get(key);
      expect(cached).not.toBeNull();
    });
  });

  describe("max entries eviction", () => {
    it("should evict oldest entry when at capacity", async () => {
      cache = new ResponseCache(3);

      await cache.set("key1", createResponse({ n: 1 }), 60);
      await cache.set("key2", createResponse({ n: 2 }), 60);
      await cache.set("key3", createResponse({ n: 3 }), 60);

      // Adding 4th should evict key1
      await cache.set("key4", createResponse({ n: 4 }), 60);

      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).not.toBeNull();
      expect(cache.get("key3")).not.toBeNull();
      expect(cache.get("key4")).not.toBeNull();
    });
  });

  describe("invalidate", () => {
    it("should invalidate specific key", async () => {
      await cache.set("key1", createResponse({ n: 1 }), 60);
      await cache.set("key2", createResponse({ n: 2 }), 60);

      const deleted = cache.invalidate("key1");

      expect(deleted).toBe(true);
      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).not.toBeNull();
    });

    it("should return false for non-existent key", () => {
      const deleted = cache.invalidate("non-existent");

      expect(deleted).toBe(false);
    });
  });

  describe("invalidatePattern", () => {
    it("should invalidate entries matching pattern", async () => {
      await cache.set("GET:/api/users/1", createResponse({ id: 1 }), 60);
      await cache.set("GET:/api/users/2", createResponse({ id: 2 }), 60);
      await cache.set("GET:/api/products/1", createResponse({ id: 1 }), 60);

      const count = cache.invalidatePattern(/\/users\//);

      expect(count).toBe(2);
      expect(cache.get("GET:/api/users/1")).toBeNull();
      expect(cache.get("GET:/api/users/2")).toBeNull();
      expect(cache.get("GET:/api/products/1")).not.toBeNull();
    });

    it("should return 0 when no matches", async () => {
      await cache.set("key1", createResponse({ n: 1 }), 60);

      const count = cache.invalidatePattern(/xyz/);

      expect(count).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all entries", async () => {
      await cache.set("key1", createResponse({ n: 1 }), 60);
      await cache.set("key2", createResponse({ n: 2 }), 60);
      await cache.set("key3", createResponse({ n: 3 }), 60);

      cache.clear();

      expect(cache.get("key1")).toBeNull();
      expect(cache.get("key2")).toBeNull();
      expect(cache.get("key3")).toBeNull();
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return correct size and maxEntries", async () => {
      cache = new ResponseCache(500);

      await cache.set("key1", createResponse({ n: 1 }), 60);
      await cache.set("key2", createResponse({ n: 2 }), 60);

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxEntries).toBe(500);
    });

    it("should return 0 size for empty cache", () => {
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("should remove expired entries during cleanup", async () => {
      await cache.set("expiring", createResponse({ data: "old" }), 0.05); // 50ms
      await cache.set("fresh", createResponse({ data: "new" }), 60);

      // Wait for expiration
      await Bun.sleep(100);

      // Start cleanup
      cache.startCleanup(50);
      await Bun.sleep(100);
      cache.stopCleanup();

      // Expiring entry should be cleaned up
      expect(cache.getStats().size).toBe(1);
    });

    it("should not start duplicate cleanup intervals", () => {
      cache.startCleanup(100);
      cache.startCleanup(100); // Should be no-op

      cache.stopCleanup();
    });

    it("should safely stop when no cleanup running", () => {
      // Should not throw
      cache.stopCleanup();
    });
  });

  describe("binary response body", () => {
    it("should handle binary response bodies", async () => {
      const key = "GET:/api/binary";
      const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const response = new Response(binaryData, {
        headers: { "Content-Type": "application/octet-stream" },
      });

      await cache.set(key, response, 60);
      const cached = cache.get(key);

      expect(cached).not.toBeNull();
      const body = await cached!.arrayBuffer();
      expect(new Uint8Array(body)).toEqual(binaryData);
    });
  });

  describe("empty response", () => {
    it("should handle empty response body", async () => {
      const key = "GET:/api/empty";
      const response = new Response(null, { status: 204 });

      await cache.set(key, response, 60);
      const cached = cache.get(key);

      expect(cached).not.toBeNull();
      expect(cached!.status).toBe(204);
    });
  });
});
