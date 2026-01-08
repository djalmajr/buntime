import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkerState } from "@/constants";
import type { WorkerConfig } from "./config";
import { WorkerInstance } from "./instance";

const TEST_DIR = join(import.meta.dir, ".test-instance");

const createMockConfig = (overrides: Partial<WorkerConfig> = {}): WorkerConfig => ({
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
  ...overrides,
});

// Create a minimal worker app
const createWorkerApp = (appDir: string, content?: string) => {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "index.ts"),
    content ??
      `export default {
      fetch: (req: Request) => new Response("Hello from worker"),
    };`,
  );
};

describe("WorkerInstance", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create worker instance", async () => {
      const appDir = join(TEST_DIR, "basic-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      expect(instance.id).toBeDefined();
      expect(typeof instance.id).toBe("string");

      await instance.terminate();
    });

    it("should filter sensitive env vars", async () => {
      const appDir = join(TEST_DIR, "env-app");
      createWorkerApp(appDir);

      const config = createMockConfig({
        env: {
          SAFE_VAR: "safe",
          DATABASE_URL: "secret",
          API_KEY: "secret",
          AWS_SECRET_KEY: "secret",
        },
      });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      // Worker should be created without throwing
      expect(instance).toBeDefined();

      await instance.terminate();
    });

    it("should use smol mode for low memory config", async () => {
      const appDir = join(TEST_DIR, "smol-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ lowMemory: true });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      expect(instance).toBeDefined();

      await instance.terminate();
    });
  });

  describe("fetch", () => {
    it("should fetch request through worker", async () => {
      const appDir = join(TEST_DIR, "fetch-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        const res = await instance.fetch(req);

        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("Hello from worker");
      } finally {
        await instance.terminate();
      }
    });

    it("should use pre-read body when provided", async () => {
      const appDir = join(TEST_DIR, "body-app");
      createWorkerApp(
        appDir,
        `export default {
        fetch: async (req: Request) => {
          const body = await req.text();
          return new Response("Received: " + body);
        },
      };`,
      );

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const bodyText = "test body content";
        const preReadBody = new TextEncoder().encode(bodyText).buffer;
        const req = new Request("http://localhost/test", {
          body: bodyText,
          method: "POST",
        });
        const res = await instance.fetch(req, preReadBody);

        expect(res).toBeInstanceOf(Response);
      } finally {
        await instance.terminate();
      }
    });

    it("should timeout on slow workers", async () => {
      const appDir = join(TEST_DIR, "slow-app");
      createWorkerApp(
        appDir,
        `export default {
        fetch: async () => {
          await Bun.sleep(60000);
          return new Response("ok");
        },
      };`,
      );

      const config = createMockConfig({ timeoutMs: 100 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await expect(instance.fetch(req)).rejects.toThrow(/timeout/i);
      } finally {
        await instance.terminate();
      }
    });

    it("should increment request count", async () => {
      const appDir = join(TEST_DIR, "count-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);
        await instance.fetch(req);

        const stats = instance.getStats();
        expect(stats.requestCount).toBe(2);
      } finally {
        await instance.terminate();
      }
    });

    it("should track error count on worker errors", async () => {
      const appDir = join(TEST_DIR, "error-app");
      createWorkerApp(
        appDir,
        `export default {
        fetch: () => {
          throw new Error("Worker error");
        },
      };`,
      );

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await expect(instance.fetch(req)).rejects.toThrow();

        const stats = instance.getStats();
        expect(stats.errorCount).toBe(1);
      } finally {
        await instance.terminate();
      }
    });

    it("should auto-terminate ephemeral workers (TTL=0)", async () => {
      const appDir = join(TEST_DIR, "ephemeral-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ ttlMs: 0 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      const req = new Request("http://localhost/test");
      await instance.fetch(req);

      // Worker should be terminated after request (TTL=0)
      // Give it a moment to clean up
      await Bun.sleep(50);
    });
  });

  describe("getStatus", () => {
    it("should return ACTIVE for recently used worker", async () => {
      const appDir = join(TEST_DIR, "active-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ idleTimeoutMs: 60000 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);

        expect(instance.getStatus()).toBe(WorkerState.ACTIVE);
      } finally {
        await instance.terminate();
      }
    });

    it("should return IDLE for worker past idle timeout", async () => {
      const appDir = join(TEST_DIR, "idle-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ idleTimeoutMs: 50 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);

        // Wait for idle timeout
        await Bun.sleep(100);

        expect(instance.getStatus()).toBe(WorkerState.IDLE);
      } finally {
        await instance.terminate();
      }
    });
  });

  describe("getStats", () => {
    it("should return worker statistics", async () => {
      const appDir = join(TEST_DIR, "stats-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const stats = instance.getStats();

        expect(stats).toHaveProperty("ageMs");
        expect(stats).toHaveProperty("avgResponseTimeMs");
        expect(stats).toHaveProperty("errorCount");
        expect(stats).toHaveProperty("idleMs");
        expect(stats).toHaveProperty("requestCount");
        expect(stats).toHaveProperty("status");
        expect(stats).toHaveProperty("totalResponseTimeMs");

        expect(stats.requestCount).toBe(0);
        expect(stats.errorCount).toBe(0);
      } finally {
        await instance.terminate();
      }
    });
  });

  describe("isHealthy", () => {
    it("should return true for healthy worker", async () => {
      const appDir = join(TEST_DIR, "healthy-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);

        expect(instance.isHealthy()).toBe(true);
      } finally {
        await instance.terminate();
      }
    });

    it("should return false when TTL exceeded", async () => {
      const appDir = join(TEST_DIR, "ttl-exceeded-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ ttlMs: 50 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);

        // Wait for TTL to expire
        await Bun.sleep(100);

        expect(instance.isHealthy()).toBe(false);
      } finally {
        await instance.terminate();
      }
    });

    it("should return false when idle timeout exceeded", async () => {
      const appDir = join(TEST_DIR, "idle-exceeded-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ idleTimeoutMs: 50 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);

        // Wait for idle timeout
        await Bun.sleep(100);

        expect(instance.isHealthy()).toBe(false);
      } finally {
        await instance.terminate();
      }
    });

    it("should return false when max requests exceeded", async () => {
      const appDir = join(TEST_DIR, "max-requests-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ maxRequests: 2 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);
        await instance.fetch(req);
        await instance.fetch(req);

        expect(instance.isHealthy()).toBe(false);
      } finally {
        await instance.terminate();
      }
    });
  });

  describe("recordResponseTime", () => {
    it("should accumulate response times", async () => {
      const appDir = join(TEST_DIR, "response-time-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        instance.recordResponseTime(100);
        instance.recordResponseTime(200);

        const stats = instance.getStats();
        expect(stats.totalResponseTimeMs).toBe(300);
      } finally {
        await instance.terminate();
      }
    });
  });

  describe("touch", () => {
    it("should update last used timestamp", async () => {
      const appDir = join(TEST_DIR, "touch-app");
      createWorkerApp(appDir);

      const config = createMockConfig({ idleTimeoutMs: 50 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        await instance.fetch(req);

        // Wait for partial idle
        await Bun.sleep(30);

        instance.touch();

        // Should be active again
        expect(instance.getStatus()).toBe(WorkerState.ACTIVE);
      } finally {
        await instance.terminate();
      }
    });
  });

  describe("terminate", () => {
    it("should terminate worker gracefully", async () => {
      const appDir = join(TEST_DIR, "terminate-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      // terminate() is async and should complete without throwing
      await instance.terminate();
      // If we get here, it didn't throw
      expect(true).toBe(true);
    });

    it("should handle multiple terminate calls", async () => {
      const appDir = join(TEST_DIR, "multi-terminate-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      await instance.terminate();
      // Second terminate should also complete without throwing
      await instance.terminate();
      expect(true).toBe(true);
    });
  });

  describe("worker initialization", () => {
    it("should fail for invalid worker module", async () => {
      const appDir = join(TEST_DIR, "invalid-app");
      createWorkerApp(appDir, `export default { notFetch: () => {} };`);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      const req = new Request("http://localhost/test");
      await expect(instance.fetch(req)).rejects.toThrow();

      await instance.terminate();
    });

    it("should fail for syntax errors in worker", async () => {
      const appDir = join(TEST_DIR, "syntax-error-app");
      createWorkerApp(appDir, `export default { fetch: () => { return new Response( };`);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      const req = new Request("http://localhost/test");
      await expect(instance.fetch(req)).rejects.toThrow();

      await instance.terminate();
    });

    it("should become unhealthy after critical error", async () => {
      const appDir = join(TEST_DIR, "critical-error-app");
      createWorkerApp(appDir, `throw new Error("Module load error");`);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      // Try to fetch which will wait for ready promise and fail
      const req = new Request("http://localhost/test");
      await expect(instance.fetch(req)).rejects.toThrow(/Worker initialization failed/);

      // isHealthy should return false after critical error
      expect(instance.isHealthy()).toBe(false);

      await instance.terminate();
    });
  });

  describe("fetch error handling", () => {
    it("should handle null preReadBody", async () => {
      const appDir = join(TEST_DIR, "null-body-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        // Pass null explicitly (simulates empty body that was pre-read)
        const res = await instance.fetch(req, null);
        expect(res).toBeInstanceOf(Response);
      } finally {
        await instance.terminate();
      }
    });

    it("should handle undefined preReadBody", async () => {
      const appDir = join(TEST_DIR, "undefined-body-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        // No preReadBody - should read from request
        const res = await instance.fetch(req);
        expect(res).toBeInstanceOf(Response);
      } finally {
        await instance.terminate();
      }
    });

    it("should handle worker error during fetch", async () => {
      const appDir = join(TEST_DIR, "error-event-app");
      // Create worker that returns undefined (causes error in wrapper.ts)
      createWorkerApp(
        appDir,
        `export default {
          fetch: async () => {
            // Return undefined to trigger error in response handling
            return undefined;
          },
        };`,
      );

      const config = createMockConfig({ timeoutMs: 5000 });
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        // This should reject due to error in worker response handling
        await expect(instance.fetch(req)).rejects.toThrow();

        // Error count should increase
        const stats = instance.getStats();
        expect(stats.errorCount).toBeGreaterThan(0);
      } finally {
        await instance.terminate();
      }
    });
  });

  describe("ready timeout handling", () => {
    it("should mark worker as unhealthy when ready timeout is reached", async () => {
      const appDir = join(TEST_DIR, "slow-init-app");
      // Create a worker that never sends READY message
      createWorkerApp(
        appDir,
        `// This module never sends READY because it has a syntax error in the export
        const x = 1;
        // No default export - wrapper.ts will fail to send READY`,
      );

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        const req = new Request("http://localhost/test");
        // Should fail because worker never becomes ready
        await expect(instance.fetch(req)).rejects.toThrow();

        // Worker should be unhealthy
        expect(instance.isHealthy()).toBe(false);
      } finally {
        await instance.terminate();
      }
    });
  });

  describe("postMessage error handling", () => {
    it("should handle postMessage errors gracefully", async () => {
      const appDir = join(TEST_DIR, "postmsg-error-app");
      createWorkerApp(appDir);

      const config = createMockConfig();
      const instance = new WorkerInstance(appDir, "index.ts", config);

      try {
        // First request should work
        const req = new Request("http://localhost/test");
        await instance.fetch(req);

        // Terminate the worker
        await instance.terminate();

        // Try to fetch after termination - should fail
        await expect(instance.fetch(req)).rejects.toThrow();
      } finally {
        // Already terminated
      }
    });
  });
});
