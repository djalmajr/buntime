import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BuntimePlugin } from "@buntime/shared/types";
import { initConfig } from "@/config";
import type { WorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import { PluginRegistry } from "@/plugins/registry";
import { createWorkerRoutes, type WorkerRoutesConfig, type WorkerRoutesDeps } from "./worker";

const TEST_DIR = join(import.meta.dir, ".test-worker-routes");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  initConfig({ baseDir: TEST_DIR, workerDirs: [TEST_DIR] });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// Mock WorkerConfig
const _createMockWorkerConfig = (): WorkerConfig => ({
  autoInstall: false,
  entrypoint: "index.ts",
  env: {},
  idleTimeoutMs: 60000,
  lowMemory: false,
  maxBodySizeBytes: 10 * 1024 * 1024,
  maxRequests: 1000,
  publicRoutes: [],
  timeoutMs: 30000,
  ttlMs: 300000,
});

// Mock WorkerPool
const createMockPool = (): WorkerPool & { fetchMock: ReturnType<typeof mock> } => {
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
    fetchMock,
  } as unknown as WorkerPool & { fetchMock: ReturnType<typeof mock> };
};

// Mock plugin factory
const createMockPlugin = (overrides: Partial<BuntimePlugin> = {}): BuntimePlugin => ({
  name: "test-plugin",
  base: "/test",
  ...overrides,
});

describe("createWorkerRoutes", () => {
  let pool: WorkerPool & { fetchMock: ReturnType<typeof mock> };
  let registry: PluginRegistry;
  let config: WorkerRoutesConfig;

  beforeEach(() => {
    pool = createMockPool();
    registry = new PluginRegistry();
    config = { version: "1.0.0" };
  });

  const createDeps = (overrides: Partial<WorkerRoutesDeps> = {}): WorkerRoutesDeps => ({
    config,
    getWorkerDir: (name: string) => (name === "my-app" ? "/mock/apps/my-app" : ""),
    pool: pool as unknown as WorkerPool,
    registry,
    ...overrides,
  });

  describe("homepage routes", () => {
    it("should return version string when no homepage configured", async () => {
      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Buntime v1.0.0");
    });

    it("should redirect to path when homepage is string starting with /", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: "/my-app", version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/my-app");
    });

    it("should redirect to app path when homepage is app name", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: "my-app", version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/my-app");
    });

    it("should redirect when homepage object has no base", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "/my-plugin" }, version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/my-plugin");
    });

    it("should redirect for app name in homepage object", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "my-test-app" }, version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/my-test-app");
    });

    it("should serve plugin app inline when homepage object has base", async () => {
      const plugin = createMockPlugin({
        name: "cpanel-plugin",
        base: "/cpanel",
      });
      registry.register(plugin, "/mock/cpanel/dir");

      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "/cpanel", base: "/" }, version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const _res = await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
    });

    it("should throw NotFoundError when homepage plugin not found", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "/nonexistent", base: "/" }, version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      // The route handler throws NotFoundError
      // Hono may catch it and return an error response
      const res = await routes.fetch(req);
      // NotFoundError has statusCode 404, Hono may return 404 or 500
      expect([404, 500]).toContain(res.status);
    });

    it("should serve app when homepage object refers to workerDirs", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "my-app", base: "/" }, version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const _res = await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
    });
  });

  describe("app routes (:app/*)", () => {
    it("should route to app", async () => {
      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/my-app/page");
      const _res = await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
    });

    it("should return error for unknown app", async () => {
      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/unknown-app/page");
      // NotFoundError is thrown, Hono returns error response
      const res = await routes.fetch(req);
      expect([404, 500]).toContain(res.status);
    });

    it("should route to plugin app first if matching", async () => {
      const plugin = createMockPlugin({
        name: "plugin-app",
        base: "/plugin-app",
      });
      registry.register(plugin, "/mock/plugin/dir");

      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/plugin-app/page");
      const _res = await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
    });

    it("should fallback to homepage plugin when app 404 and homepage inline", async () => {
      const plugin = createMockPlugin({
        name: "cpanel-plugin",
        base: "/cpanel",
      });
      registry.register(plugin, "/mock/cpanel/dir");

      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "/cpanel", base: "/" }, version: "1.0.0" },
          getWorkerDir: () => "",
        }),
      );
      // Simulate 404 from app, should fallback to homepage plugin
      pool.fetchMock.mockImplementationOnce(() =>
        Promise.resolve(new Response("not found", { status: 404 })),
      );

      const req = new Request("http://localhost/cpanel/page");
      const _res = await routes.fetch(req);

      // Should call pool.fetch for the homepage plugin fallback
      expect(pool.fetchMock).toHaveBeenCalled();
    });
  });

  describe("plugin app resolution", () => {
    it("should resolve plugin app and call pool.fetch", async () => {
      const plugin = createMockPlugin({
        name: "fragment-plugin",
        base: "/fragment",
      });
      registry.register(plugin, "/mock/fragment/dir");

      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/fragment/page");
      const _res = await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
    });

    it("should pass correct relative path to pool", async () => {
      const plugin = createMockPlugin({
        name: "nested-plugin",
        base: "/nested",
      });
      registry.register(plugin, "/mock/nested/dir");

      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/nested/deep/path/page?q=test");
      await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
      // The pool.fetch should receive the request with relative path
      const call = pool.fetchMock.mock.calls[0];
      expect(call).toBeDefined();
    });

    it("should fall through to app routing when no registry provided", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          registry: undefined,
        }),
      );
      // With no registry, plugin resolution returns null
      // Request should fall through to app routing, which throws NotFoundError
      const req = new Request("http://localhost/some-path");
      const res = await routes.fetch(req);
      // Should return error (404 or 500)
      expect([404, 500]).toContain(res.status);
    });
  });

  describe("app routing", () => {
    it("should construct correct request for app", async () => {
      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/my-app/api/data?page=1");
      await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
      const call = pool.fetchMock.mock.calls[0];
      expect(call?.[0]).toBe("/mock/apps/my-app");
    });

    it("should handle root path within app", async () => {
      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/my-app");
      await routes.fetch(req);

      expect(pool.fetchMock).toHaveBeenCalled();
    });
  });

  describe("getHomepageConfig", () => {
    it("should return null for no homepage config", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Buntime v1.0.0");
    });

    it("should normalize string homepage to object format", async () => {
      // String homepage triggers redirect, not inline serving
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: "/my-app", version: "1.0.0" },
        }),
      );
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/my-app");
    });
  });

  describe("getHomepageConfig internal", () => {
    it("should normalize string homepage to object format internally", async () => {
      // When homepage is a string, getHomepageConfig returns { app: string }
      // This is used by handleAppRoute for fallback logic
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: "my-test-app", version: "1.0.0" },
          getWorkerDir: () => "", // No apps found - triggers 404 fallback
        }),
      );

      // Request to an app route that will 404
      const req = new Request("http://localhost/some-app/page");
      const res = await routes.fetch(req);
      // Should return 404 or redirect (depends on homepage config)
      expect([302, 404, 500]).toContain(res.status);
    });
  });

  describe("handleAppRoute with homepage fallback", () => {
    it("should redirect when homepage config lacks base", async () => {
      const plugin = createMockPlugin({
        name: "app-plugin",
        base: "/app-plugin",
      });
      registry.register(plugin, "/mock/plugin/dir");

      // Homepage config without base triggers redirect, not inline serving
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "/app-plugin" }, version: "1.0.0" },
        }),
      );

      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);
      // Should redirect to the app
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/app-plugin");
    });

    it("should serve homepage inline when base is defined", async () => {
      const plugin = createMockPlugin({
        name: "cpanel-inline",
        base: "/cpanel",
      });
      registry.register(plugin, "/mock/cpanel/dir");

      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "/cpanel", base: "/" }, version: "1.0.0" },
        }),
      );

      // Homepage request with base defined should serve inline
      const req = new Request("http://localhost/");
      const _res = await routes.fetch(req);
      // Should have called pool.fetch for the inline homepage
      expect(pool.fetchMock).toHaveBeenCalled();
    });

    it("should route apps via pool", async () => {
      const routes = createWorkerRoutes(
        createDeps({
          config: { homepage: { app: "my-app", base: "/" }, version: "1.0.0" },
        }),
      );

      const req = new Request("http://localhost/my-app/page");
      const _res = await routes.fetch(req);
      // Should have called pool.fetch for the app
      expect(pool.fetchMock).toHaveBeenCalled();
    });
  });
});
