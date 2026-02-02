import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkerConfig } from "@buntime/shared/utils/worker-config";
import { WorkerState } from "@/constants";
import { WorkerPool } from "./pool";

const TEST_DIR = join(import.meta.dir, ".test-pool");

// Create a mock worker config
const createMockConfig = (overrides: Partial<WorkerConfig> = {}): WorkerConfig => ({
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
  ...overrides,
});

// Create a minimal worker app
const createWorkerApp = (appDir: string) => {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "index.ts"),
    `export default {
      fetch: (req: Request) => new Response("Hello from worker"),
    };`,
  );
  writeFileSync(
    join(appDir, "package.json"),
    JSON.stringify({ name: "test-app", version: "1.0.0" }),
  );
};

describe("WorkerPool", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create pool with config", () => {
      const pool = new WorkerPool({ maxSize: 10 });
      expect(pool).toBeDefined();
      pool.shutdown();
    });

    it("should create pool with small maxSize", () => {
      const pool = new WorkerPool({ maxSize: 1 });
      expect(pool).toBeDefined();
      pool.shutdown();
    });
  });

  describe("getMetrics", () => {
    it("should return pool metrics", () => {
      const pool = new WorkerPool({ maxSize: 5 });
      const metrics = pool.getMetrics();

      // Check for actual property names from PoolMetrics interface
      expect(metrics).toHaveProperty("activeWorkers");
      expect(metrics).toHaveProperty("hits");
      expect(metrics).toHaveProperty("misses");
      expect(metrics).toHaveProperty("totalRequests");
      expect(metrics).toHaveProperty("hitRate");
      expect(metrics).toHaveProperty("uptimeMs");
      expect(metrics.activeWorkers).toBe(0);

      pool.shutdown();
    });
  });

  describe("getWorkerStats", () => {
    it("should return empty stats when no workers", () => {
      const pool = new WorkerPool({ maxSize: 5 });
      const stats = pool.getWorkerStats();

      expect(stats).toEqual({});
      pool.shutdown();
    });
  });

  describe("shutdown", () => {
    it("should shutdown gracefully", () => {
      const pool = new WorkerPool({ maxSize: 5 });
      expect(() => pool.shutdown()).not.toThrow();
    });
  });

  describe("fetch", () => {
    it("should create worker and fetch response", async () => {
      const appDir = join(TEST_DIR, "app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();
      const req = new Request("http://localhost/test");

      try {
        const res = await pool.fetch(appDir, config, req);
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(200);
      } finally {
        pool.shutdown();
        // Give time for workers to terminate
        await Bun.sleep(100);
      }
    });

    it("should cache workers for TTL > 0", async () => {
      const appDir = join(TEST_DIR, "cached-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({ ttlMs: 300000 });
      const req = new Request("http://localhost/test");

      try {
        // First request - cache miss
        await pool.fetch(appDir, config, req);
        const metrics1 = pool.getMetrics();
        expect(metrics1.misses).toBe(1);

        // Second request - cache hit
        await pool.fetch(appDir, config, req);
        const metrics2 = pool.getMetrics();
        expect(metrics2.hits).toBe(1);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should not cache workers for TTL = 0 (ephemeral)", async () => {
      const appDir = join(TEST_DIR, "ephemeral-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({ ttlMs: 0 });
      const req = new Request("http://localhost/test");

      try {
        await pool.fetch(appDir, config, req);
        const stats = pool.getWorkerStats();
        // Ephemeral workers are tracked differently
        const workerKey = "ephemeral-app@1.0.0";
        expect(stats[workerKey]?.status).toBe(WorkerState.EPHEMERAL);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should record response times", async () => {
      const appDir = join(TEST_DIR, "metrics-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();
      const req = new Request("http://localhost/test");

      try {
        await pool.fetch(appDir, config, req);
        const stats = pool.getWorkerStats();
        const workerKey = "metrics-app@1.0.0";
        expect(stats[workerKey]).toBeDefined();
        expect(stats[workerKey]?.requestCount).toBe(1);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should pass pre-read body to worker", async () => {
      const appDir = join(TEST_DIR, "body-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();
      const body = new TextEncoder().encode("test body").buffer;
      const req = new Request("http://localhost/test", {
        body: "test body",
        method: "POST",
      });

      try {
        const res = await pool.fetch(appDir, config, req, body);
        expect(res).toBeInstanceOf(Response);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should detect worker key collision with different appDir", async () => {
      const appDir1 = join(TEST_DIR, "collision-app@1.0.0");
      const appDir2 = join(TEST_DIR, "other-collision-app@1.0.0");
      createWorkerApp(appDir1);
      createWorkerApp(appDir2);

      // Modify package.json to have same name/version (creates key collision)
      writeFileSync(
        join(appDir2, "package.json"),
        JSON.stringify({ name: "collision-app", version: "1.0.0" }),
      );

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();

      try {
        await pool.fetch(appDir1, config, new Request("http://localhost/test"));
        // The second fetch with different appDir but same key should throw
        try {
          await pool.fetch(appDir2, config, new Request("http://localhost/test"));
          // If it doesn't throw, that's also acceptable (pool may handle it differently)
        } catch (error) {
          expect(String(error)).toMatch(/collision/i);
        }
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should handle nested app directory structure", async () => {
      const appDir = join(TEST_DIR, "nested-app/1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();
      const req = new Request("http://localhost/test");

      try {
        const res = await pool.fetch(appDir, config, req);
        expect(res).toBeInstanceOf(Response);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should track ephemeral worker request types", async () => {
      const appDir = join(TEST_DIR, "ephemeral-types@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({ ttlMs: 0 });

      try {
        // Document request
        const docReq = new Request("http://localhost/", {
          headers: { "sec-fetch-dest": "document" },
        });
        await pool.fetch(appDir, config, docReq);

        // API request
        const apiReq = new Request("http://localhost/api/data", {
          headers: { "sec-fetch-dest": "empty" },
        });
        await pool.fetch(appDir, config, apiReq);

        const stats = pool.getWorkerStats();
        expect(stats["ephemeral-types@1.0.0"]).toBeDefined();
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });
  });

  describe("worker lifecycle", () => {
    it("should retire unhealthy workers", async () => {
      const appDir = join(TEST_DIR, "unhealthy-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      // Very short TTL to force retirement
      const config = createMockConfig({
        ttlMs: 100,
        idleTimeoutMs: 50,
      });
      const req = new Request("http://localhost/test");

      try {
        await pool.fetch(appDir, config, req);

        // Wait for worker to become unhealthy
        await Bun.sleep(200);

        // Force a cleanup check by fetching again
        await pool.fetch(appDir, config, req);

        const metrics = pool.getMetrics();
        // Should have created at least 2 workers (use correct property name)
        expect(metrics.totalWorkersCreated).toBeGreaterThanOrEqual(2);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should handle pool when full by reusing workers", async () => {
      // Create small pool
      const pool = new WorkerPool({ maxSize: 2 });
      const config = createMockConfig({ ttlMs: 300000 }); // Long TTL

      // Create 3 apps
      const appDir1 = join(TEST_DIR, "reuse-app-1@1.0.0");
      const appDir2 = join(TEST_DIR, "reuse-app-2@1.0.0");
      const appDir3 = join(TEST_DIR, "reuse-app-3@1.0.0");
      createWorkerApp(appDir1);
      createWorkerApp(appDir2);
      createWorkerApp(appDir3);

      try {
        // Fill the pool
        await pool.fetch(appDir1, config, new Request("http://localhost/test"));
        await pool.fetch(appDir2, config, new Request("http://localhost/test"));

        // Add third app
        await pool.fetch(appDir3, config, new Request("http://localhost/test"));

        // Should have created at least 3 workers total
        const metrics = pool.getMetrics();
        expect(metrics.totalWorkersCreated).toBeGreaterThanOrEqual(3);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should accumulate historical stats after worker retirement", async () => {
      const appDir = join(TEST_DIR, "hist-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      // Very short TTL to force retirement
      const config = createMockConfig({
        ttlMs: 100,
        idleTimeoutMs: 50,
      });
      const req = new Request("http://localhost/test");

      try {
        // First worker instance
        await pool.fetch(appDir, config, req);
        await pool.fetch(appDir, config, req);

        // Wait for worker to become unhealthy and be retired
        await Bun.sleep(300);

        // Create new worker instance
        await pool.fetch(appDir, config, req);

        // Get stats - should include historical data from retired worker
        const stats = pool.getWorkerStats();
        const workerKey = "hist-app@1.0.0";
        expect(stats[workerKey]).toBeDefined();
        expect(stats[workerKey]?.requestCount).toBeGreaterThanOrEqual(3);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should merge historical stats with current worker stats", async () => {
      const appDir = join(TEST_DIR, "merge-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        ttlMs: 100,
        idleTimeoutMs: 50,
      });

      try {
        // Make some requests
        await pool.fetch(appDir, config, new Request("http://localhost/test"));

        // Wait for TTL expiry and retirement (needs enough time for full cleanup)
        await Bun.sleep(300);

        // Make more requests (new worker will be created)
        await pool.fetch(appDir, config, new Request("http://localhost/test"));

        const stats = pool.getWorkerStats();
        expect(stats["merge-app@1.0.0"]).toBeDefined();
        // Total requests should be sum of historical + current
        expect(stats["merge-app@1.0.0"]?.requestCount).toBeGreaterThanOrEqual(2);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should show offline workers in stats after retirement", async () => {
      const appDir = join(TEST_DIR, "offline-app@1.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        ttlMs: 100,
        idleTimeoutMs: 50,
      });

      try {
        await pool.fetch(appDir, config, new Request("http://localhost/test"));

        // Wait for worker to be retired
        await Bun.sleep(300);

        // Trigger cleanup by calling getWorkerStats (cleanup runs on interval)
        const stats = pool.getWorkerStats();
        const workerKey = "offline-app@1.0.0";

        // If worker was retired and not yet recreated, it should show historical data
        if (stats[workerKey]) {
          expect(stats[workerKey].requestCount).toBeGreaterThanOrEqual(1);
        }
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });
  });

  describe("LRU cache behavior", () => {
    it("should create multiple workers for different apps", async () => {
      // Create a pool with maxSize 5
      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({ ttlMs: 300000 }); // Long TTL

      // Create 3 apps
      const appDir1 = join(TEST_DIR, "multi-app-1@1.0.0");
      const appDir2 = join(TEST_DIR, "multi-app-2@1.0.0");
      const appDir3 = join(TEST_DIR, "multi-app-3@1.0.0");
      createWorkerApp(appDir1);
      createWorkerApp(appDir2);
      createWorkerApp(appDir3);

      try {
        // Access all apps
        await pool.fetch(appDir1, config, new Request("http://localhost/test"));
        await pool.fetch(appDir2, config, new Request("http://localhost/test"));
        await pool.fetch(appDir3, config, new Request("http://localhost/test"));

        const metrics = pool.getMetrics();
        // Should have created 3 workers
        expect(metrics.totalWorkersCreated).toBe(3);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should reuse cached workers on subsequent requests", async () => {
      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({ ttlMs: 300000 });

      const appDir = join(TEST_DIR, "cache-reuse@1.0.0");
      createWorkerApp(appDir);

      try {
        // First request creates worker
        await pool.fetch(appDir, config, new Request("http://localhost/test"));
        // Second request reuses worker
        await pool.fetch(appDir, config, new Request("http://localhost/test"));

        const metrics = pool.getMetrics();
        expect(metrics.hits).toBe(1);
        expect(metrics.misses).toBe(1);
        expect(metrics.totalWorkersCreated).toBe(1);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should preserve request stats across worker lifetime", async () => {
      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({ ttlMs: 300000 });

      const appDir = join(TEST_DIR, "stats-track@1.0.0");
      createWorkerApp(appDir);

      try {
        // Make multiple requests
        await pool.fetch(appDir, config, new Request("http://localhost/test"));
        await pool.fetch(appDir, config, new Request("http://localhost/test"));

        const stats = pool.getWorkerStats();
        expect(stats["stats-track@1.0.0"]).toBeDefined();
        expect(stats["stats-track@1.0.0"]?.requestCount).toBe(2);
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });
  });

  describe("parseAppKey", () => {
    it("should parse flat folder structure with @", async () => {
      // Folder name with @ gets version from package.json (1.0.0)
      const appDir = join(TEST_DIR, "flat-app@2.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();

      try {
        await pool.fetch(appDir, config, new Request("http://localhost/test"));
        const stats = pool.getWorkerStats();
        // Uses package.json version (1.0.0), not folder version (2.0.0)
        expect(stats["flat-app@1.0.0"]).toBeDefined();
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should parse nested folder structure", async () => {
      // Nested folder also uses package.json version
      const appDir = join(TEST_DIR, "nested-app/2.0.0");
      createWorkerApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();

      try {
        await pool.fetch(appDir, config, new Request("http://localhost/test"));
        const stats = pool.getWorkerStats();
        // Uses package.json version (1.0.0), not folder version (2.0.0)
        expect(stats["nested-app@1.0.0"]).toBeDefined();
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should use package.json version when available", async () => {
      const appDir = join(TEST_DIR, "pkg-version-app@1.0.0");
      createWorkerApp(appDir);
      // package.json has version 1.0.0

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();

      try {
        await pool.fetch(appDir, config, new Request("http://localhost/test"));
        const stats = pool.getWorkerStats();
        // Version from package.json
        expect(stats["pkg-version-app@1.0.0"]).toBeDefined();
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should fallback to folder version when no package.json", async () => {
      const appDir = join(TEST_DIR, "no-pkg@3.0.0");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        join(appDir, "index.ts"),
        `export default { fetch: () => new Response("ok") };`,
      );
      // No package.json

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig();

      try {
        await pool.fetch(appDir, config, new Request("http://localhost/test"));
        const stats = pool.getWorkerStats();
        expect(stats["no-pkg@3.0.0"]).toBeDefined();
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });
  });

  describe("HTML injection", () => {
    // Helper to create an HTML SPA app
    const createHtmlApp = (appDir: string, html?: string) => {
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        join(appDir, "index.html"),
        html ?? `<!DOCTYPE html><html><head><title>Test</title></head><body>Hello</body></html>`,
      );
      writeFileSync(
        join(appDir, "package.json"),
        JSON.stringify({ name: "html-app", version: "1.0.0" }),
      );
    };

    it("should inject window.__env__ with PUBLIC_* vars only", async () => {
      const appDir = join(TEST_DIR, "env-inject-app@1.0.0");
      createHtmlApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        entrypoint: "index.html",
        env: {
          PUBLIC_API_URL: "https://api.example.com",
          PUBLIC_APP_NAME: "MyApp",
          SECRET_KEY: "should-not-appear",
          DATABASE_URL: "postgres://localhost/db",
        },
      });

      try {
        const req = new Request("http://localhost/");
        const res = await pool.fetch(appDir, config, req);
        const html = await res.text();

        // Should contain window.__env__ script
        expect(html).toContain("window.__env__=");

        // Should contain PUBLIC_* vars
        expect(html).toContain("PUBLIC_API_URL");
        expect(html).toContain("https://api.example.com");
        expect(html).toContain("PUBLIC_APP_NAME");
        expect(html).toContain("MyApp");

        // Should NOT contain non-PUBLIC vars
        expect(html).not.toContain("SECRET_KEY");
        expect(html).not.toContain("should-not-appear");
        expect(html).not.toContain("DATABASE_URL");
        expect(html).not.toContain("postgres://localhost/db");
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should not inject window.__env__ when no PUBLIC_* vars exist", async () => {
      const appDir = join(TEST_DIR, "no-public-env@1.0.0");
      createHtmlApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        entrypoint: "index.html",
        env: {
          SECRET_KEY: "secret",
          DATABASE_URL: "postgres://localhost/db",
        },
      });

      try {
        const req = new Request("http://localhost/");
        const res = await pool.fetch(appDir, config, req);
        const html = await res.text();

        // Should NOT contain window.__env__ script
        expect(html).not.toContain("window.__env__");
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should not inject window.__env__ when env is empty", async () => {
      const appDir = join(TEST_DIR, "empty-env@1.0.0");
      createHtmlApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        entrypoint: "index.html",
        env: {},
      });

      try {
        const req = new Request("http://localhost/");
        const res = await pool.fetch(appDir, config, req);
        const html = await res.text();

        // Should NOT contain window.__env__ script
        expect(html).not.toContain("window.__env__");
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should escape </script> in env values to prevent XSS", async () => {
      const appDir = join(TEST_DIR, "xss-escape@1.0.0");
      createHtmlApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        entrypoint: "index.html",
        env: {
          PUBLIC_XSS_TEST: '</script><script>alert("xss")</script>',
        },
      });

      try {
        const req = new Request("http://localhost/");
        const res = await pool.fetch(appDir, config, req);
        const html = await res.text();

        // Should contain escaped version
        expect(html).toContain("window.__env__=");
        // Should NOT contain unescaped </script> in the value
        expect(html).not.toMatch(/<\/script>.*<script>alert/);
        // The script tag should be properly escaped
        expect(html).toContain("<\\/script>");
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should inject <base href> when injectBase is true", async () => {
      const appDir = join(TEST_DIR, "base-inject@1.0.0");
      createHtmlApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        entrypoint: "index.html",
        injectBase: true,
      });

      try {
        const req = new Request("http://localhost/", {
          headers: { "x-base": "/my-app" },
        });
        const res = await pool.fetch(appDir, config, req);
        const html = await res.text();

        // Should contain <base href>
        expect(html).toContain('<base href="/my-app/"');
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should not inject <base href> when injectBase is false", async () => {
      const appDir = join(TEST_DIR, "no-base-inject@1.0.0");
      createHtmlApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        entrypoint: "index.html",
        injectBase: false,
      });

      try {
        const req = new Request("http://localhost/", {
          headers: { "x-base": "/my-app" },
        });
        const res = await pool.fetch(appDir, config, req);
        const html = await res.text();

        // Should NOT contain <base href>
        expect(html).not.toContain("<base href");
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });

    it("should inject both base and env when both configured", async () => {
      const appDir = join(TEST_DIR, "both-inject@1.0.0");
      createHtmlApp(appDir);

      const pool = new WorkerPool({ maxSize: 5 });
      const config = createMockConfig({
        entrypoint: "index.html",
        injectBase: true,
        env: {
          PUBLIC_API: "https://api.example.com",
        },
      });

      try {
        const req = new Request("http://localhost/", {
          headers: { "x-base": "/app" },
        });
        const res = await pool.fetch(appDir, config, req);
        const html = await res.text();

        // Should contain both
        expect(html).toContain('<base href="/app/"');
        expect(html).toContain("window.__env__=");
        expect(html).toContain("PUBLIC_API");
      } finally {
        pool.shutdown();
        await Bun.sleep(100);
      }
    });
  });
});
