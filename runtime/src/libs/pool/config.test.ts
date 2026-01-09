import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as runtimeConfig from "@/config";
import { ConfigDefaults, loadWorkerConfig } from "./config";

describe("ConfigDefaults", () => {
  it("should have correct default values", () => {
    expect(ConfigDefaults.autoInstall).toBe(false);
    expect(ConfigDefaults.idleTimeout).toBe(60);
    expect(ConfigDefaults.lowMemory).toBe(false);
    expect(ConfigDefaults.maxRequests).toBe(1000);
    expect(ConfigDefaults.timeout).toBe(30);
    expect(ConfigDefaults.ttl).toBe(0);
  });

  it("should have all expected keys", () => {
    const keys = Object.keys(ConfigDefaults).sort();
    expect(keys).toEqual([
      "autoInstall",
      "idleTimeout",
      "lowMemory",
      "maxRequests",
      "timeout",
      "ttl",
    ]);
  });

  it("should have idleTimeout in seconds", () => {
    expect(ConfigDefaults.idleTimeout).toBe(60);
  });

  it("should have timeout in seconds", () => {
    expect(ConfigDefaults.timeout).toBe(30);
  });

  it("should have ttl of 0 for ephemeral mode by default", () => {
    expect(ConfigDefaults.ttl).toBe(0);
  });

  it("should have maxRequests for worker recycling", () => {
    expect(ConfigDefaults.maxRequests).toBe(1000);
  });
});

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
      workspaces: ["/tmp"],
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

  describe("package.json buntime section", () => {
    it("should load config from package.json#buntime", async () => {
      const uniqueDir = join(baseTestDir, `pkg-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          buntime: {
            timeout: 45,
            maxRequests: 500,
            lowMemory: true,
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.timeoutMs).toBe(45 * 1000);
      expect(config.maxRequests).toBe(500);
      expect(config.lowMemory).toBe(true);
    });

    it("should handle package.json without buntime section", async () => {
      const uniqueDir = join(baseTestDir, `pkg-no-buntime-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
        }),
      );

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

    it("should parse maxBodySize from package.json", async () => {
      const uniqueDir = join(baseTestDir, `body-pkg-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            maxBodySize: "5mb",
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.maxBodySizeBytes).toBe(5 * 1024 * 1024);
    });

    it("should cap maxBodySize to runtime max", async () => {
      const uniqueDir = join(baseTestDir, `body-cap-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            maxBodySize: "500mb", // Exceeds 100mb max
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      // Should be capped to runtime max (100mb)
      expect(config.maxBodySizeBytes).toBe(100 * 1024 * 1024);
    });
  });

  describe("duration parsing", () => {
    it("should parse numeric durations as seconds", async () => {
      const uniqueDir = join(baseTestDir, `duration-num-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            timeout: 45,
            idleTimeout: 120,
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.timeoutMs).toBe(45 * 1000);
      expect(config.idleTimeoutMs).toBe(120 * 1000);
    });

    it("should parse string durations", async () => {
      const uniqueDir = join(baseTestDir, `duration-str-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            timeout: "1m",
            idleTimeout: "5m",
            ttl: "1h",
          },
        }),
      );

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

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            timeout: 0,
          },
        }),
      );

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/timeout must be positive/);
    });

    it("should throw for negative ttl", async () => {
      const uniqueDir = join(baseTestDir, `val-ttl-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            timeout: 30,
            ttl: -1,
          },
        }),
      );

      // Zod validates first with "Too small" error
      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/Invalid config.*ttl/);
    });

    it("should throw for zero idleTimeout", async () => {
      const uniqueDir = join(baseTestDir, `val-idle-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            idleTimeout: 0,
          },
        }),
      );

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/idleTimeout must be positive/);
    });

    it("should throw when ttl < timeout for persistent workers", async () => {
      const uniqueDir = join(baseTestDir, `val-ttl-timeout-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            timeout: 60,
            ttl: 30, // Less than timeout
          },
        }),
      );

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/ttl.*must be >= timeout/);
    });

    it("should throw when idleTimeout < timeout for persistent workers", async () => {
      const uniqueDir = join(baseTestDir, `val-idle-timeout-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            timeout: 60,
            idleTimeout: 30, // Less than timeout
            ttl: 120,
          },
        }),
      );

      await expect(loadWorkerConfig(uniqueDir)).rejects.toThrow(/idleTimeout.*must be >= timeout/);
    });

    it("should adjust idleTimeout when it exceeds ttl", async () => {
      const uniqueDir = join(baseTestDir, `val-adjust-idle-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            timeout: 30,
            idleTimeout: 300, // Exceeds ttl
            ttl: 120,
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      // Should be adjusted to ttl
      expect(config.idleTimeoutMs).toBe(120 * 1000);
    });
  });

  describe("publicRoutes", () => {
    it("should parse array format", async () => {
      const uniqueDir = join(baseTestDir, `routes-arr-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            publicRoutes: ["/health", "/api/public/*"],
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.publicRoutes).toEqual(["/health", "/api/public/*"]);
    });

    it("should parse object format with HTTP methods", async () => {
      const uniqueDir = join(baseTestDir, `routes-obj-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            publicRoutes: {
              GET: ["/health"],
              POST: ["/webhook"],
            },
          },
        }),
      );

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

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            entrypoint: "src/server.ts",
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.entrypoint).toBe("src/server.ts");
    });

    it("should parse autoInstall option", async () => {
      const uniqueDir = join(baseTestDir, `auto-${Date.now()}-${Math.random()}`);
      mkdirSync(uniqueDir, { recursive: true });

      writeFileSync(
        join(uniqueDir, "package.json"),
        JSON.stringify({
          name: "test",
          buntime: {
            autoInstall: true,
          },
        }),
      );

      const config = await loadWorkerConfig(uniqueDir);

      expect(config.autoInstall).toBe(true);
    });
  });
});
