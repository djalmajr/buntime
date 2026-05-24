import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuntimePlugin } from "@buntime/shared/types";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import { initConfig } from "@/config";
import { API_PATH, Headers } from "@/constants";
import { ApiKeyStore } from "@/libs/api-keys";
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
    // Mock core routes - mounted at API_PATH in the app
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
    coreRoutes,
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
      const req = new Request(`http://localhost${API_PATH}/plugins/loaded`);
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
      const req = new Request(`http://localhost${API_PATH}/data`, {
        method: "POST",
        headers: { host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
    });

    it("should allow internal requests with X-Buntime-Internal header", async () => {
      const workersMock = new HonoApp().all("*", () => new Response("ok"));
      const app = createApp(createDeps({ workers: workersMock }));
      const req = new Request(`http://localhost${API_PATH}/data`, {
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
      const req = new Request(`http://localhost${API_PATH}/data`, {
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
      const req = new Request(`http://localhost${API_PATH}/data`, {
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
      const req = new Request(`http://localhost${API_PATH}/data`, {
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
      const req = new Request(`http://localhost${API_PATH}/data`, {
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
      const req = new Request(`http://localhost${API_PATH}/data`, {
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
      const req = new Request(`http://localhost${API_PATH}/data`, {
        method: "GET",
        headers: { host: "localhost" },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });

    it("should require API key for protected API routes when configured", async () => {
      Bun.env.RUNTIME_ROOT_KEY = "test-root-key";
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      try {
        const app = createApp(createDeps());
        const req = new Request(`http://localhost${API_PATH}/plugins`, {
          headers: { host: "localhost" },
        });
        const res = await app.fetch(req);
        expect(res.status).toBe(401);
      } finally {
        delete Bun.env.RUNTIME_ROOT_KEY;
        initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
      }
    });

    it("should let POST /admin/session through the runtime gate WITHOUT credentials", async () => {
      // The login endpoint must be reachable without prior auth — that is the
      // whole point. Without this exception the cpanel can never log in.
      // We assert by negation: the gate's own 401 carries the AUTH_REQUIRED
      // code; anything past the gate produces a different response shape
      // (or a 404 if the test coreRoutes mock doesn't mount /admin/session).
      Bun.env.RUNTIME_ROOT_KEY = "test-root-key";
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      try {
        const app = createApp(createDeps());
        const req = new Request(`http://localhost${API_PATH}/admin/session`, {
          body: JSON.stringify({ key: "test-root-key" }),
          headers: {
            "content-type": "application/json",
            host: "localhost",
            origin: "http://localhost",
          },
          method: "POST",
        });
        const res = await app.fetch(req);
        if (res.status === 401) {
          const body = (await res.json()) as { code?: string };
          expect(body.code).not.toBe("AUTH_REQUIRED");
        }
      } finally {
        delete Bun.env.RUNTIME_ROOT_KEY;
        initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
      }
    });

    it("should let DELETE /admin/session through the gate (logout is idempotent)", async () => {
      Bun.env.RUNTIME_ROOT_KEY = "test-root-key";
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      try {
        const app = createApp(createDeps());
        const req = new Request(`http://localhost${API_PATH}/admin/session`, {
          headers: { host: "localhost", origin: "http://localhost" },
          method: "DELETE",
        });
        const res = await app.fetch(req);
        // The gate must not 401 this; if a downstream handler is mocked into
        // coreRoutes for the test it may return 204, otherwise 200/404 — what
        // matters is that the AUTH_REQUIRED gate did not fire.
        if (res.status === 401) {
          const body = (await res.json()) as { code?: string };
          expect(body.code).not.toBe("AUTH_REQUIRED");
        }
      } finally {
        delete Bun.env.RUNTIME_ROOT_KEY;
        initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
      }
    });

    it("should still require credentials for GET /admin/session", async () => {
      Bun.env.RUNTIME_ROOT_KEY = "test-root-key";
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      try {
        const app = createApp(createDeps());
        const req = new Request(`http://localhost${API_PATH}/admin/session`, {
          headers: { host: "localhost" },
        });
        const res = await app.fetch(req);
        expect(res.status).toBe(401);
      } finally {
        delete Bun.env.RUNTIME_ROOT_KEY;
        initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
      }
    });

    it("should authenticate API requests via the session cookie", async () => {
      // The whole point of the migration: same-origin requests with the
      // session cookie bypass the runtime gate so plugin iframes (which
      // cannot inject headers) reach their routes.
      Bun.env.RUNTIME_ROOT_KEY = "test-root-key";
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      try {
        const app = createApp(createDeps());
        const req = new Request(`http://localhost${API_PATH}/admin/session`, {
          headers: {
            cookie: "buntime_api_key=test-root-key",
            host: "localhost",
          },
        });
        const res = await app.fetch(req);
        expect(res.status).toBe(200);
      } finally {
        delete Bun.env.RUNTIME_ROOT_KEY;
        initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
      }
    });

    it("should allow API key to bypass CSRF for deployment automation", async () => {
      Bun.env.RUNTIME_ROOT_KEY = "test-root-key";
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      try {
        const app = createApp(createDeps());
        const req = new Request(`http://localhost${API_PATH}/plugins`, {
          method: "POST",
          headers: {
            host: "localhost",
            [Headers.API_KEY]: "test-root-key",
          },
        });
        const res = await app.fetch(req);
        expect(res.status).not.toBe(403);
      } finally {
        delete Bun.env.RUNTIME_ROOT_KEY;
        initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
      }
    });

    it("should allow generated API keys with required permissions", async () => {
      const apiKeys = await ApiKeyStore.open({
        dbPath: join(TEST_DIR, "generated-api-keys.db"),
        mode: "local",
      });
      const created = await apiKeys.create({ name: "Deploy", role: "editor" });
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const app = createApp(createDeps({ apiKeys }));
      const req = new Request(`http://localhost${API_PATH}/plugins`, {
        headers: {
          host: "localhost",
          [Headers.API_KEY]: created.key,
        },
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(200);
    });

    it("should reject generated API keys without required permissions", async () => {
      const apiKeys = await ApiKeyStore.open({
        dbPath: join(TEST_DIR, "viewer-api-keys.db"),
        mode: "local",
      });
      const created = await apiKeys.create({ name: "Viewer", role: "viewer" });
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const app = createApp(createDeps({ apiKeys }));
      const req = new Request(`http://localhost${API_PATH}/plugins/reload`, {
        headers: {
          host: "localhost",
          [Headers.API_KEY]: created.key,
        },
        method: "POST",
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("rejects a worker action in a namespace the key cannot access", async () => {
      const apiKeys = await ApiKeyStore.open({
        dbPath: join(TEST_DIR, "ns-worker-deny.db"),
        mode: "local",
      });
      // admin role => all permissions, so only the namespace gate can 403.
      const created = await apiKeys.create({
        name: "CentralIT",
        namespaces: ["@acme"],
        role: "admin",
      });
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const app = createApp(createDeps({ apiKeys }));
      const req = new Request(`http://localhost${API_PATH}/workers/@team/billing/1.0.0/disable`, {
        headers: { host: "localhost", [Headers.API_KEY]: created.key },
        method: "POST",
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "NAMESPACE_DENIED" });
    });

    it("allows a worker action in the key's own namespace", async () => {
      const apiKeys = await ApiKeyStore.open({
        dbPath: join(TEST_DIR, "ns-worker-allow.db"),
        mode: "local",
      });
      const created = await apiKeys.create({
        name: "CentralIT",
        namespaces: ["@acme"],
        role: "admin",
      });
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const app = createApp(createDeps({ apiKeys }));
      const req = new Request(`http://localhost${API_PATH}/workers/@acme/checkout/1.0.0/disable`, {
        headers: { host: "localhost", [Headers.API_KEY]: created.key },
        method: "POST",
      });
      const res = await app.fetch(req);
      // The gate lets it through; the mock coreRoutes has no such route (404),
      // proving only that we did NOT 403 on the namespace.
      expect(res.status).not.toBe(403);
    });

    it("rejects a plugin action in a namespace the key cannot access", async () => {
      const apiKeys = await ApiKeyStore.open({
        dbPath: join(TEST_DIR, "ns-plugin-deny.db"),
        mode: "local",
      });
      const created = await apiKeys.create({
        name: "CentralIT",
        namespaces: ["@acme"],
        role: "admin",
      });
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const app = createApp(createDeps({ apiKeys }));
      // Plugin name is URL-encoded (`@team/foo`).
      const req = new Request(`http://localhost${API_PATH}/plugins/%40team%2Ffoo`, {
        headers: { host: "localhost", [Headers.API_KEY]: created.key },
        method: "DELETE",
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "NAMESPACE_DENIED" });
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

    // The runtime-credential bypass of plugin onRequest hooks must be scoped to
    // HEADER credentials (automation). A `buntime_api_key` cookie is a browser
    // cpanel session and must NOT disable content plugins (gateway app-shell,
    // proxy) for ordinary app traffic on the same browser.
    it("does NOT bypass onRequest hooks for a cookie session", async () => {
      const apiKeys = await ApiKeyStore.open({
        dbPath: join(TEST_DIR, "cookie-no-bypass.db"),
        mode: "local",
      });
      const created = await apiKeys.create({ name: "Session", role: "editor" });
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const hookCalled = { value: false };
      registry.register(
        createMockPlugin({
          base: "/shell-like",
          name: "shell-like",
          onRequest: async () => {
            hookCalled.value = true;
            return new Response("shell-served", { status: 200 });
          },
        }),
      );

      const app = createApp(createDeps({ apiKeys }));
      const req = new Request("http://localhost/some-app", {
        headers: {
          cookie: `buntime_api_key=${created.key}`,
          host: "localhost",
          origin: "http://localhost",
        },
      });
      const res = await app.fetch(req);
      expect(hookCalled.value).toBe(true); // onRequest ran despite the valid cookie
      expect(await res.text()).toBe("shell-served");
    });

    it("bypasses onRequest hooks for a header credential (automation)", async () => {
      const apiKeys = await ApiKeyStore.open({
        dbPath: join(TEST_DIR, "header-bypass.db"),
        mode: "local",
      });
      const created = await apiKeys.create({ name: "Automation", role: "editor" });
      initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });

      const hookCalled = { value: false };
      registry.register(
        createMockPlugin({
          base: "/shell-like-2",
          name: "shell-like-2",
          onRequest: async () => {
            hookCalled.value = true;
            return new Response("shell-served", { status: 200 });
          },
        }),
      );

      const workersMock = new HonoApp().all("*", () => new Response("worker-fallback"));
      const app = createApp(createDeps({ apiKeys, workers: workersMock }));
      const req = new Request("http://localhost/some-app", {
        headers: { host: "localhost", [Headers.API_KEY]: created.key },
      });
      const res = await app.fetch(req);
      expect(hookCalled.value).toBe(false); // onRequest bypassed for the header credential
      expect(await res.text()).toBe("worker-fallback");
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

  describe("trailing-slash redirect for entry-pointed workers", () => {
    it("should redirect /<base> → /<base>/ when worker has entrypoint (GET)", async () => {
      const appDir = join(TEST_DIR, "spa-app");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        join(appDir, "manifest.yaml"),
        ["entrypoint: dist/index.html", "injectBase: true", ""].join("\n"),
      );
      try {
        const app = createApp(
          createDeps({
            getWorkerDir: (name) => (name === "spa-app" ? appDir : undefined),
          }),
        );
        const req = new Request("http://localhost/spa-app", {
          headers: { host: "localhost" },
        });
        const res = await app.fetch(req);
        expect(res.status).toBe(308);
        expect(res.headers.get("location")).toBe("http://localhost/spa-app/");
      } finally {
        rmSync(appDir, { force: true, recursive: true });
      }
    });

    it("should NOT redirect /<base>/ (already canonical)", async () => {
      const appDir = join(TEST_DIR, "spa-app-2");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "manifest.yaml"), ["entrypoint: dist/index.html", ""].join("\n"));
      try {
        const workersMock = new HonoApp().all("*", () => new Response("spa"));
        const app = createApp(
          createDeps({
            getWorkerDir: (name) => (name === "spa-app-2" ? appDir : undefined),
            workers: workersMock,
          }),
        );
        const req = new Request("http://localhost/spa-app-2/", {
          headers: { host: "localhost" },
        });
        const res = await app.fetch(req);
        expect(res.status).not.toBe(308);
      } finally {
        rmSync(appDir, { force: true, recursive: true });
      }
    });

    it("should NOT redirect when worker has no entrypoint (serverless API workers)", async () => {
      const appDir = join(TEST_DIR, "api-only-app");
      mkdirSync(appDir, { recursive: true });
      // No entrypoint — pure serverless API worker.
      writeFileSync(join(appDir, "manifest.yaml"), "\n");
      try {
        const workersMock = new HonoApp().all("*", () => new Response("api"));
        const app = createApp(
          createDeps({
            getWorkerDir: (name) => (name === "api-only-app" ? appDir : undefined),
            workers: workersMock,
          }),
        );
        const req = new Request("http://localhost/api-only-app", {
          headers: { host: "localhost" },
        });
        const res = await app.fetch(req);
        expect(res.status).not.toBe(308);
      } finally {
        rmSync(appDir, { force: true, recursive: true });
      }
    });

    it("should NOT redirect on POST (would lose request body)", async () => {
      const appDir = join(TEST_DIR, "spa-app-post");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(join(appDir, "manifest.yaml"), ["entrypoint: dist/index.html", ""].join("\n"));
      try {
        const workersMock = new HonoApp().all("*", () => new Response("ok"));
        const app = createApp(
          createDeps({
            getWorkerDir: (name) => (name === "spa-app-post" ? appDir : undefined),
            workers: workersMock,
          }),
        );
        const req = new Request("http://localhost/spa-app-post", {
          body: '{"hello":"world"}',
          headers: {
            "content-type": "application/json",
            host: "localhost",
            origin: "http://localhost",
          },
          method: "POST",
        });
        const res = await app.fetch(req);
        expect(res.status).not.toBe(308);
      } finally {
        rmSync(appDir, { force: true, recursive: true });
      }
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
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
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
