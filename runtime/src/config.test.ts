import { beforeEach, describe, expect, it } from "bun:test";
import { getConfig, initConfig } from "./config";
import { BodySizeLimits } from "./constants";

describe("config", () => {
  // Env vars that tests may modify - always clean these up
  const testEnvVars = ["POOL_SIZE", "WORKER_DIRS", "HOMEPAGE_APP", "PLUGIN_DIRS", "CONFIG_DIR"] as const;

  beforeEach(() => {
    // Clean up test env vars before each test
    for (const key of testEnvVars) {
      delete Bun.env[key];
    }
  });

  describe("initConfig", () => {
    it("should initialize with workerDirs from options", () => {
      const result = initConfig({ workerDirs: ["/tmp/apps"] });
      expect(result.workerDirs).toContain("/tmp/apps");
    });

    it("should resolve relative workerDirs paths against baseDir", () => {
      const result = initConfig({ baseDir: "/base", workerDirs: ["./apps"] });
      expect(result.workerDirs).toContain("/base/apps");
    });

    it("should throw when workerDirs is empty", () => {
      expect(() => initConfig({ workerDirs: [] })).toThrow(/workerDirs is required/);
    });

    it("should use WORKER_DIRS env var when not in options", () => {
      Bun.env.WORKER_DIRS = "/env/apps";

      const result = initConfig();
      expect(result.workerDirs).toContain("/env/apps");
    });

    it("should handle comma-separated WORKER_DIRS", () => {
      Bun.env.WORKER_DIRS = "/app1,/app2,/app3";

      const result = initConfig();
      expect(result.workerDirs).toContain("/app1");
      expect(result.workerDirs).toContain("/app2");
      expect(result.workerDirs).toContain("/app3");
    });

    it("should use POOL_SIZE env var", () => {
      Bun.env.POOL_SIZE = "100";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.poolSize).toBe(100);
    });

    it("should use default poolSize for environment", () => {
      const result = initConfig({ workerDirs: ["/tmp"] });
      // Default for test environment is 5
      expect(result.poolSize).toBe(5);
    });

    it("should handle invalid POOL_SIZE gracefully", () => {
      Bun.env.POOL_SIZE = "invalid";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.poolSize).toBeGreaterThan(0);
    });

    it("should use HOMEPAGE_APP env var", () => {
      Bun.env.HOMEPAGE_APP = "my-app";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.homepage).toBe("my-app");
    });

    it("should use default body size limits", () => {
      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.bodySize.default).toBe(BodySizeLimits.DEFAULT);
      expect(result.bodySize.max).toBe(BodySizeLimits.MAX);
    });

    it("should include static config values", () => {
      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(typeof result.delayMs).toBe("number");
      expect(typeof result.isCompiled).toBe("boolean");
      expect(typeof result.isDev).toBe("boolean");
      expect(typeof result.nodeEnv).toBe("string");
      expect(typeof result.port).toBe("number");
      expect(typeof result.version).toBe("string");
    });

    it("should use configDir from options", () => {
      const result = initConfig({ configDir: "/custom/data", workerDirs: ["/tmp"] });
      expect(result.configDir).toBe("/custom/data");
    });

    it("should use CONFIG_DIR env var as fallback", () => {
      Bun.env.CONFIG_DIR = "/env/data";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.configDir).toBe("/env/data");
    });

    it("should use default pluginDirs", () => {
      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.pluginDirs.length).toBeGreaterThan(0);
    });

    it("should use PLUGIN_DIRS env var", () => {
      Bun.env.PLUGIN_DIRS = "/custom/plugins";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.pluginDirs).toContain("/custom/plugins");
    });
  });

  describe("getConfig", () => {
    it("should return initialized config", () => {
      initConfig({ workerDirs: ["/tmp"] });
      const result = getConfig();

      expect(result.workerDirs).toContain("/tmp");
    });
  });
});
