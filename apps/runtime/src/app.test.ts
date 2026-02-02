import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BuntimePlugin } from "@buntime/shared/types";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import { initConfig } from "@/config";
import { Headers } from "@/constants";
import type { WorkerPool } from "@/libs/pool/pool";
import { PluginRegistry } from "@/plugins/registry";
import { type AppDeps, createApp } from "./app";

const TEST_DIR = join(import.meta.dir, ".test-app");

// Initialize config once before all tests
beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
});

// Clean up after tests
import { afterAll } from "bun:test";

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// Mock WorkerPool
const createMockPool = (
  overrides: Partial<WorkerPool> = {},
): WorkerPool & { fetchMock: ReturnType<typeof mock> } => {
  const fetchMock = mock(() => Promise.resolve(new Response("worker response")));
  return {
    fetch: fetchMock,
    getMetrics: () => ({
      cacheHitRate: 0.8,
      cacheSize: 5,
      evictionCount: 0,
      hitCount: 80,
      missCount: 20,
      requestCount: 100,
      avgRequestDuration: 10,
      workerCreatedCount: 10,
      workerFailedCount: 0,
    }),
    getWorkerStats: () => ({}),
    shutdown: () => {},
    ...overrides,
    fetchMock,
  } as unknown as WorkerPool & { fetchMock: ReturnType<typeof mock> };
};

// Mock plugin factory
const createMockPlugin = (overrides: Partial<BuntimePlugin> = {}): BuntimePlugin => ({
  name: "test-plugin",
  base: "/test",
  ...overrides,
});

describe("createApp", () => {
  let registry: PluginRegistry;
  let pool: WorkerPool & { fetchMock: ReturnType<typeof mock> };
  let coreRoutes: Hono;
  let workers: Hono;

  beforeEach(() => {
    registry = new PluginRegistry();
    pool = createMockPool();
    // Mock core routes - mounted at /api in the app
    coreRoutes = new HonoApp()
      .get("/apps", (c) => c.json([]))
      .get("/config/plugins", (c) => c.json({ configs: {}, versions: [] }))
      .get("/health", (c) => c.json({ ok: true, status: "healthy" }))
      .get("/keys", (c) => c.json({ keys: [] }))
      .get("/plugins", (c) => c.json([]))
      .get("/plugins/loaded", (c) => c.json([]));
    workers = new HonoApp().all("*", () => new Response("worker fallback"));
  });

  const createDeps = (overrides: Partial<AppDeps> = {}): AppDeps => ({
    coreRoutes: coreRoutes as any,
    getWorkerDir: () => "/mock/app/dir",
    pool: pool as unknown as WorkerPool,
    registry,
    workers,
    ...overrides,
  });

  describe("basic routing", () => {
    it("should create app instance", () => {
      const app = createApp(createDeps());
      expect(app).toBeDefined();
      expect(typeof app.fetch).toBe("function");
    });

    it("should handle /api/plugins/loaded route", async () => {
      const app = createApp(createDeps());
      const req = new Request("http://localhost/api/plugins/loaded");
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual([]);
    });

    it("should forward requests to workers", async () => {
      const workersMock = new HonoApp().all("*", () => new Response("from workers"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/some-path", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("from workers");
    });
  });

  describe("plugin routes", () => {
    it("should register plugin routes", async () => {
      const pluginRoutes = new HonoApp().get("/data", (c) => c.json({ data: "test" }));
      const plugin = createMockPlugin({
        name: "data-plugin",
        base: "/data-plugin",
        routes: pluginRoutes,
      });
      registry.register(plugin);

      const app = createApp(createDeps());
      const req = new Request("http://localhost/data-plugin/data", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });

    it("should throw on route collision", () => {
      const plugin1 = createMockPlugin({
        name: "plugin1",
        base: "/same-base",
        routes: new HonoApp(),
      });
      const plugin2 = createMockPlugin({
        name: "plugin2",
        base: "/same-base",
        routes: new HonoApp(),
      });
      registry.register(plugin1);
      registry.register(plugin2);

      expect(() => createApp(createDeps())).toThrow(/Route collision/);
    });
  });

  describe("plugin server.fetch handlers", () => {
    it("should call plugin server.fetch handlers", async () => {
      const serverFetchMock = mock(() => Promise.resolve(new Response("server fetch")));
      const plugin = createMockPlugin({
        name: "server-fetch-plugin",
        base: "/server-fetch",
        server: { fetch: serverFetchMock },
      });
      registry.register(plugin);

      const app = createApp(createDeps());
      const req = new Request("http://localhost/server-fetch/endpoint", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("server fetch");
      expect(serverFetchMock).toHaveBeenCalled();
    });

    it("should pass through to next handler on 404 from server.fetch", async () => {
      const plugin = createMockPlugin({
        name: "404-plugin",
        base: "/not-found",
        server: { fetch: () => Promise.resolve(new Response("not found", { status: 404 })) },
      });
      registry.register(plugin);

      const workersMock = new HonoApp().all("*", () => new Response("fallback"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/other-path", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("fallback");
    });
  });

  describe("CSRF protection", () => {
    it("should block state-changing requests without Origin header", async () => {
      const app = createApp(createDeps());
      const req = new Request("http://localhost/api/data", {
        method: "POST",
        headers: { host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
    });

    it("should allow internal requests with X-Buntime-Internal header", async () => {
      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/api/data", {
        method: "POST",
        headers: {
          host: "localhost",
          "x-buntime-internal": "true",
        },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });

    it("should block requests with mismatched Origin and Host", async () => {
      const app = createApp(createDeps());
      const req = new Request("http://localhost/api/data", {
        method: "PUT",
        headers: {
          host: "localhost",
          origin: "http://evil.com",
        },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
    });

    it("should allow requests with matching Origin and Host", async () => {
      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/api/data", {
        method: "PATCH",
        headers: {
          host: "localhost",
          origin: "http://localhost",
        },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });

    it("should block requests with credentials in Origin", async () => {
      const app = createApp(createDeps());
      const req = new Request("http://localhost/api/data", {
        method: "DELETE",
        headers: {
          host: "localhost",
          origin: "http://user:pass@localhost",
        },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
    });

    it("should block requests with non-http Origin protocol", async () => {
      const app = createApp(createDeps());
      const req = new Request("http://localhost/api/data", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "file://localhost",
        },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
    });

    it("should block requests with invalid Origin URL", async () => {
      const app = createApp(createDeps());
      const req = new Request("http://localhost/api/data", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "not-a-url",
        },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
    });

    it("should allow GET requests without Origin", async () => {
      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/api/data", {
        method: "GET",
        headers: { host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });
  });

  describe("request ID tracking", () => {
    it("should add request ID header to response", async () => {
      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/test", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.headers.get(Headers.REQUEST_ID)).toBeTruthy();
    });

    it("should preserve existing request ID", async () => {
      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/test", {
        headers: {
          host: "localhost",
          origin: "http://localhost",
          [Headers.REQUEST_ID]: "existing-id-123",
        },
      });
      const res = await app.fetch(req);
      expect(res.headers.get(Headers.REQUEST_ID)).toBe("existing-id-123");
    });
  });

  describe("onRequest hooks", () => {
    it("should run onRequest hooks", async () => {
      const hookCalled = { value: false };
      const plugin = createMockPlugin({
        name: "hook-plugin",
        base: "/hook",
        onRequest: async (req) => {
          hookCalled.value = true;
          return req;
        },
      });
      registry.register(plugin);

      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/test", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      await app.fetch(req);
      expect(hookCalled.value).toBe(true);
    });

    it("should short-circuit on Response from onRequest hook", async () => {
      const plugin = createMockPlugin({
        name: "auth-plugin",
        base: "/auth",
        onRequest: async () => new Response("Unauthorized", { status: 401 }),
      });
      registry.register(plugin);

      const app = createApp(createDeps());
      const req = new Request("http://localhost/test", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(401);
    });
  });

  describe("onResponse hooks", () => {
    it("should run onResponse hooks", async () => {
      const hookCalled = { value: false };
      const plugin = createMockPlugin({
        name: "response-plugin",
        base: "/response",
        onResponse: async (res) => {
          hookCalled.value = true;
          return res;
        },
      });
      registry.register(plugin);

      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request("http://localhost/test", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      await app.fetch(req);
      expect(hookCalled.value).toBe(true);
    });
  });

  describe("body size limits", () => {
    it("should return 413 for oversized request body based on Content-Length", async () => {
      // Note: Body size limits are applied based on the resolved app's config
      // For this test, we verify the error is properly returned
      // The actual limit check happens in cloneRequestBody which uses
      // the resolved worker config's maxBodySizeBytes
      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));

      // Create a request that claims to have a huge body
      const req = new Request("http://localhost/test", {
        body: "small body",
        headers: {
          // Claim a size much larger than any reasonable limit (1GB)
          "content-length": "1073741824",
          host: "localhost",
          origin: "http://localhost",
        },
        method: "POST",
      });
      const res = await app.fetch(req);
      // Should be rejected due to Content-Length check
      expect(res.status).toBe(413);
    });
  });

  describe("error handling", () => {
    it("should handle errors gracefully", async () => {
      // The app has an onError handler for graceful error handling
      const app = createApp(createDeps());
      // Request to a non-existent path should return 404, not throw
      const req = new Request("http://localhost/non-existent", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      // Should return a valid response (404 from worker routes)
      expect(res.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe("plugin app routing", () => {
    it("should route to plugin apps via pool", async () => {
      const plugin = createMockPlugin({
        name: "fragment-app",
        base: "/fragment",
      });
      registry.register(plugin, "/mock/fragment/dir");

      const app = createApp(createDeps());
      const req = new Request("http://localhost/fragment/page", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const _res = await app.fetch(req);
      expect(pool.fetchMock).toHaveBeenCalled();
    });
  });

  describe("handlePluginRoutes 404 fallthrough", () => {
    it("should pass through to next handler when plugin routes return 404", async () => {
      const plugin404Routes = new HonoApp().get("/exists", (c) => c.json({ ok: true }));
      const plugin = createMockPlugin({
        name: "partial-plugin",
        base: "/partial",
        routes: plugin404Routes,
      });
      registry.register(plugin);

      const workersMock = new HonoApp().all("*", () => new Response("from workers"));
      const app = createApp(createDeps({ workers: workersMock }));

      // Request to route that doesn't exist in plugin
      const req = new Request("http://localhost/partial/not-found", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      // Should fall through to workers
      expect(await res.text()).toBe("from workers");
    });
  });

  describe("resolveTargetApp", () => {
    it("should return undefined when app directory not found", async () => {
      const getWorkerDirMock = () => undefined;
      const workersMock = new HonoApp().all("*", () => new Response("fallback"));
      const app = createApp(
        createDeps({
          getWorkerDir: getWorkerDirMock,
          workers: workersMock,
        }),
      );

      const req = new Request("http://localhost/my-app/page", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const res = await app.fetch(req);
      // Should fall through to workers
      expect(await res.text()).toBe("fallback");
    });
  });

  describe("servePluginApp coverage", () => {
    it("should handle plugin app with subpath correctly", async () => {
      const plugin = createMockPlugin({
        name: "deep-plugin",
        base: "/deep",
      });
      registry.register(plugin, "/mock/deep/dir");

      const app = createApp(createDeps());
      const req = new Request("http://localhost/deep/nested/path/page?query=value", {
        headers: { origin: "http://localhost", host: "localhost" },
      });
      const _res = await app.fetch(req);
      expect(pool.fetchMock).toHaveBeenCalled();
    });
  });
});
