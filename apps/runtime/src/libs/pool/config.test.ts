import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as runtimeConfig from "@/config";
import { loadWorkerConfig } from "./config";

// Helper to write YAML manifest
function writeManifest(dir: string, data: Record<string, unknown>) {
  writeFileSync(join(dir, "manifest.yaml"), Bun.YAML.stringify(data));
}

describe("loadWorkerConfig", () => {
  // Use unique test directories with timestamps to avoid Bun module cache
  const baseTestDir = join(import.meta.dirname, "__test-worker-config__");

  beforeAll(() => {
    mkdirSync(baseTestDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(baseTestDir)) {
      rmSync(baseTestDir, { recursive: true });
    }
  });

  beforeEach(() => {
    spyOn(runtimeConfig, "getConfig").mockReturnValue({
      bodySize: { default: 10 * 1024 * 1024, max: 100 * 1024 * 1024 },
      delayMs: 100,
      isCompiled: false,
      isDev: true,
      nodeEnv: "test",
      pluginDirs: ["./plugins"],
      poolSize: 10,
      port: 8000,
      version: "1.0.0",
      workerDirs: ["/tmp"],
    });
  });

  describe("default values without config files", () => {
    it("should return defaults when directory has no config", async () => {
      const uniqueDir = join(baseTestDir, `empty-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.autoInstall).toBe(false);
      expect(config.lowMemory).toBe(false);
      expect(config.maxRequests).toBe(1000);
      expect(config.timeoutMs).toBe(30 * 1000);
      expect(config.ttlMs).toBe(0);
      expect(config.idleTimeoutMs).toBe(60 * 1000);
      expect(config.maxBodySizeBytes).toBe(10 * 1024 * 1024);
    });
  });

  describe("manifest.yaml config", () => {
    it("should load config from manifest.yaml", async () => {
      const uniqueDir = join(baseTestDir, `manifest-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: 45,
        maxRequests: 500,
        lowMemory: true,
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.timeoutMs).toBe(45 * 1000);
      expect(config.maxRequests).toBe(500);
      expect(config.lowMemory).toBe(true);
    });

    it("should use defaults when no manifest exists", async () => {
      const uniqueDir = join(baseTestDir, `no-manifest-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      const config = await loadWorkerConfig(uniqueDir);

      // Should use defaults
      expect(config.timeoutMs).toBe(30 * 1000);
      expect(config.maxRequests).toBe(1000);
    });
  });

  describe("WorkerConfig interface", () => {
    it("should return WorkerConfig with all required fields", async () => {
      const uniqueDir = join(baseTestDir, `interface-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      const config = await loadWorkerConfig(uniqueDir);

      // Verify all required fields exist
      expect(typeof config.autoInstall).toBe("boolean");
      expect(typeof config.idleTimeoutMs).toBe("number");
      expect(typeof config.lowMemory).toBe("boolean");
      expect(typeof config.maxBodySizeBytes).toBe("number");
      expect(typeof config.maxRequests).toBe("number");
      expect(typeof config.timeoutMs).toBe("number");
      expect(typeof config.ttlMs).toBe("number");

      // Optional fields can be undefined
      expect(config.entrypoint === undefined || typeof config.entrypoint === "string").toBe(true);
      expect(config.publicRoutes === undefined || typeof config.publicRoutes === "object").toBe(
        true,
      );
    });
  });

  describe("maxBodySize validation", () => {
    it("should use default maxBodySize from runtime config", async () => {
      const uniqueDir = join(baseTestDir, `body-default-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.maxBodySizeBytes).toBe(10 * 1024 * 1024);
    });

    it("should parse maxBodySize from manifest.yaml", async () => {
      const uniqueDir = join(baseTestDir, `body-manifest-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        maxBodySize: "5mb",
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.maxBodySizeBytes).toBe(5 * 1024 * 1024);
    });

    it("should cap maxBodySize to runtime max", async () => {
      const uniqueDir = join(baseTestDir, `body-cap-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        maxBodySize: "500mb", // Exceeds 100mb max
      });

      const config = await loadWorkerConfig(uniqueDir);

      // Should be capped to runtime max (100mb)
      expect(config.maxBodySizeBytes).toBe(100 * 1024 * 1024);
    });
  });

  describe("duration parsing", () => {
    it("should parse numeric durations as seconds", async () => {
      const uniqueDir = join(baseTestDir, `duration-num-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: 45,
        idleTimeout: 120,
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.timeoutMs).toBe(45 * 1000);
      expect(config.idleTimeoutMs).toBe(120 * 1000);
    });

    it("should parse string durations", async () => {
      const uniqueDir = join(baseTestDir, `duration-str-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: "1m",
        idleTimeout: "5m",
        ttl: "1h",
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.timeoutMs).toBe(60 * 1000);
      expect(config.idleTimeoutMs).toBe(5 * 60 * 1000);
      expect(config.ttlMs).toBe(60 * 60 * 1000);
    });
  });

  describe("validation errors", () => {
    it("should throw for invalid timeout (zero)", async () => {
      const uniqueDir = join(baseTestDir, `val-timeout-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: 0,
      });

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/timeout must be positive/);
    });

    it("should throw for negative ttl", async () => {
      const uniqueDir = join(baseTestDir, `val-ttl-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: 30,
        ttl: -1,
      });

      // Zod validates first with "Too small" error
      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/Invalid config.*ttl/);
    });

    it("should throw for zero idleTimeout", async () => {
      const uniqueDir = join(baseTestDir, `val-idle-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        idleTimeout: 0,
      });

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/idleTimeout must be positive/);
    });

    it("should throw when ttl < timeout for persistent workers", async () => {
      const uniqueDir = join(baseTestDir, `val-ttl-timeout-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: 60,
        ttl: 30, // Less than timeout
      });

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/ttl.*must be >= timeout/);
    });

    it("should throw when idleTimeout < timeout for persistent workers", async () => {
      const uniqueDir = join(baseTestDir, `val-idle-timeout-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: 60,
        idleTimeout: 30, // Less than timeout
        ttl: 120,
      });

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/idleTimeout.*must be >= timeout/);
    });

    it("should adjust idleTimeout when it exceeds ttl", async () => {
      const uniqueDir = join(baseTestDir, `val-adjust-idle-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        timeout: 30,
        idleTimeout: 300, // Exceeds ttl
        ttl: 120,
      });

      const config = await loadWorkerConfig(uniqueDir);

      // Should be adjusted to ttl
      expect(config.idleTimeoutMs).toBe(120 * 1000);
    });
  });

  describe("publicRoutes", () => {
    it("should parse array format", async () => {
      const uniqueDir = join(baseTestDir, `routes-arr-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        publicRoutes: ["/health", "/api/public/*"],
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.publicRoutes).toEqual(["/health", "/api/public/*"]);
    });

    it("should parse object format with HTTP methods", async () => {
      const uniqueDir = join(baseTestDir, `routes-obj-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        publicRoutes: {
          GET: ["/health"],
          POST: ["/webhook"],
        },
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.publicRoutes).toEqual({
        GET: ["/health"],
        POST: ["/webhook"],
      });
    });
  });

  describe("optional fields", () => {
    it("should include entrypoint when specified", async () => {
      const uniqueDir = join(baseTestDir, `entry-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        entrypoint: "src/server.ts",
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.entrypoint).toBe("src/server.ts");
    });

    it("should parse autoInstall option", async () => {
      const uniqueDir = join(baseTestDir, `auto-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        autoInstall: true,
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.autoInstall).toBe(true);
    });
  });

  describe("injectBase", () => {
    it("should default to false", async () => {
      const uniqueDir = join(baseTestDir, `inject-default-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.injectBase).toBe(false);
    });

    it("should parse injectBase: true", async () => {
      const uniqueDir = join(baseTestDir, `inject-true-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        injectBase: true,
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.injectBase).toBe(true);
    });

    it("should parse injectBase: false explicitly", async () => {
      const uniqueDir = join(baseTestDir, `inject-false-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        injectBase: false,
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.injectBase).toBe(false);
    });
  });

  describe("env", () => {
    it("should parse env variables from manifest", async () => {
      const uniqueDir = join(baseTestDir, `env-parse-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        env: {
          PUBLIC_API_URL: "https://api.example.com",
          DATABASE_URL: "postgres://localhost/db",
        },
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toEqual({
        PUBLIC_API_URL: "https://api.example.com",
        DATABASE_URL: "postgres://localhost/db",
      });
    });

    it("should be undefined when not specified", async () => {
      const uniqueDir = join(baseTestDir, `env-undefined-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toBeUndefined();
    });

    it("should coerce non-string env values to strings", async () => {
      const uniqueDir = join(baseTestDir, `env-coerce-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        env: {
          DEBUG: true,
          DEV: false,
          GITLAB_PROJECT_ID: 12345,
          MINIO_PORT: 9000,
          MINIO_USE_SSL: false,
          NORMAL_STRING: "hello",
        },
      });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toEqual({
        DEBUG: "true",
        DEV: "false",
        GITLAB_PROJECT_ID: "12345",
        MINIO_PORT: "9000",
        MINIO_USE_SSL: "false",
        NORMAL_STRING: "hello",
      });
    });
  });

  describe(".env file support", () => {
    it("should load env variables from .env file", async () => {
      const uniqueDir = join(baseTestDir, `dotenv-only-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(join(uniqueDir, ".env"), "FOO=bar\nBAZ=qux");

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should merge .env with manifest.yaml env (dotenv has higher priority)", async () => {
      const uniqueDir = join(baseTestDir, `dotenv-merge-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeManifest(uniqueDir, {
        env: {
          FOO: "from-manifest",
          ONLY_MANIFEST: "manifest-value",
        },
      });
      writeFileSync(join(uniqueDir, ".env"), "FOO=from-dotenv\nONLY_DOTENV=dotenv-value");

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toEqual({
        FOO: "from-dotenv", // .env wins
        ONLY_MANIFEST: "manifest-value", // from manifest
        ONLY_DOTENV: "dotenv-value", // from .env
      });
    });

    it("should handle .env with comments and empty lines", async () => {
      const uniqueDir = join(baseTestDir, `dotenv-comments-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, ".env"),
        "# This is a comment\nFOO=bar\n\n# Another comment\nBAZ=qux",
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toEqual({ FOO: "bar", BAZ: "qux" });
    });

    it("should handle .env with quoted values", async () => {
      const uniqueDir = join(baseTestDir, `dotenv-quotes-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, ".env"),
        "DOUBLE=\"value with spaces\"\nSINGLE='another value'",
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toEqual({
        DOUBLE: "value with spaces",
        SINGLE: "another value",
      });
    });

    it("should handle .env with complex values (URLs, special chars)", async () => {
      const uniqueDir = join(baseTestDir, `dotenv-complex-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, ".env"),
        "DATABASE_URL=postgres://user:pass@host:5432/db?ssl=true\nAPI_KEY=abc123!@#$%",
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toEqual({
        DATABASE_URL: "postgres://user:pass@host:5432/db?ssl=true",
        API_KEY: "abc123!@#$%",
      });
    });

    it("should return undefined env when neither manifest nor .env has env vars", async () => {
      const uniqueDir = join(baseTestDir, `dotenv-none-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.env).toBeUndefined();
    });
  });
});
