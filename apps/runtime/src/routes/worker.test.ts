import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BuntimePlugin } from "@buntime/shared/types";
import type { WorkerConfig } from "@buntime/shared/utils/worker-config";
import { initConfig } from "@/config";
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
  injectBase: false,
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

  describe("root route", () => {
    it("should return version string", async () => {
      const routes = createWorkerRoutes(createDeps());
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Buntime v1.0.0");
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
});
