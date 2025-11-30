import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigDefaults, loadWorkerConfig } from "./config";

const APP_DIR = join(import.meta.dir, ".test-config-app");
const PATTERN = "^/api/(.*)$";

beforeEach(() => {
  mkdirSync(APP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(APP_DIR, { recursive: true, force: true });
});

const writeConfig = <T = Record<string, unknown>>(filename: string, values: T) => {
  writeFileSync(join(APP_DIR, filename), JSON.stringify(values));
  return values;
};

describe("loadWorkerConfig", () => {
  describe("default configuration", () => {
    it("should return default values when no config file exists", async () => {
      const config = await loadWorkerConfig(APP_DIR);

      expect(config.entrypoint).toBeUndefined();
      expect(config.idleTimeoutMs).toBe(ConfigDefaults.idleTimeout * 1000);
      expect(config.lowMemory).toBe(ConfigDefaults.lowMemory);
      expect(config.maxRequests).toBe(ConfigDefaults.maxRequests);
      expect(config.proxy).toBeUndefined();
      expect(config.timeoutMs).toBe(ConfigDefaults.timeout * 1000);
      expect(config.ttlMs).toBe(ConfigDefaults.ttl * 1000);
    });
  });

  describe("worker.config.json", () => {
    it("should load configuration from worker.config.json", async () => {
      const json = writeConfig("worker.config.json", {
        entrypoint: "src/main.ts",
        idleTimeout: 30,
        lowMemory: true,
        maxRequests: 500,
        timeout: 60,
        ttl: 120,
      });

      const config = await loadWorkerConfig(APP_DIR);

      expect(config.entrypoint).toBe(json.entrypoint);
      expect(config.idleTimeoutMs).toBe(json.idleTimeout * 1000);
      expect(config.lowMemory).toBe(json.lowMemory);
      expect(config.maxRequests).toBe(json.maxRequests);
      expect(config.timeoutMs).toBe(json.timeout * 1000);
      expect(config.ttlMs).toBe(json.ttl * 1000);
    });

    it("should load proxy configuration", async () => {
      const json = writeConfig("worker.config.json", {
        proxy: [
          {
            changeOrigin: true,
            pattern: PATTERN,
            rewrite: "/v1/$1",
            target: "http://localhost:3000",
          },
        ],
      });

      const config = await loadWorkerConfig(APP_DIR);

      expect(config.proxy).toBeDefined();
      expect(config.proxy?.[0]?.target).toBe(json.proxy[0]!.target);
    });
  });

  describe("package.json workerConfig", () => {
    it("should load configuration from package.json workerConfig", async () => {
      const json = writeConfig("package.json", {
        name: "test-app",
        workerConfig: {
          entrypoint: "dist/index.js",
          timeout: 45,
        },
      });

      const config = await loadWorkerConfig(APP_DIR);

      expect(config.entrypoint).toBe(json.workerConfig.entrypoint);
      expect(config.timeoutMs).toBe(json.workerConfig.timeout * 1000);
    });

    it("should prioritize worker.config.json over package.json", async () => {
      writeConfig("worker.config.json", { timeout: 100 });
      writeConfig("package.json", { name: "test-app", workerConfig: { timeout: 50 } });

      const config = await loadWorkerConfig(APP_DIR);

      expect(config.timeoutMs).toBe(100_000);
    });
  });

  describe("environment variable resolution", () => {
    beforeEach(() => {
      Bun.env.TEST_API_URL = "http://test-api.example.com";
      Bun.env.TEST_PORT = "8080";
    });

    it("should resolve environment variables in proxy targets", async () => {
      writeConfig("worker.config.json", {
        proxy: [{ pattern: PATTERN, target: "${TEST_API_URL}" }],
      });

      const config = await loadWorkerConfig(APP_DIR);

      expect(config.proxy?.[0]?.target).toBe(Bun.env.TEST_API_URL!);
    });

    it("should resolve multiple environment variables", async () => {
      writeConfig("worker.config.json", {
        proxy: [{ pattern: PATTERN, target: "${TEST_API_URL}:${TEST_PORT}" }],
      });

      const config = await loadWorkerConfig(APP_DIR);

      expect(config.proxy?.[0]?.target).toBe(`${Bun.env.TEST_API_URL}:${Bun.env.TEST_PORT}`);
    });

    it("should replace undefined env vars with empty string", async () => {
      writeConfig("worker.config.json", {
        proxy: [{ pattern: PATTERN, target: "http://localhost${UNDEFINED_VAR}/api" }],
      });

      const config = await loadWorkerConfig(APP_DIR);

      expect(config.proxy?.[0]?.target).toBe("http://localhost/api");
    });
  });

  describe("validation errors", () => {
    it("should throw error for invalid timeout value", () => {
      writeConfig("worker.config.json", { timeout: -10 });

      expect(loadWorkerConfig(APP_DIR)).rejects.toThrow("Invalid worker config");
    });

    it("should throw error for invalid proxy target type", () => {
      writeConfig("worker.config.json", {
        proxy: [{ pattern: PATTERN, target: 123 }],
      });

      expect(loadWorkerConfig(APP_DIR)).rejects.toThrow("Invalid worker config");
    });
  });
});
