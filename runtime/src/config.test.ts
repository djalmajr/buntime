import { beforeEach, describe, expect, it } from "bun:test";
import { getConfig, initConfig } from "./config";
import { BodySizeLimits } from "./constants";

describe("config", () => {
  // Env vars that tests may modify - always clean these up
  const testEnvVars = [
    "POOL_SIZE",
    "WORKER_DIRS",
    "HOMEPAGE_APP",
    "PLUGIN_DIRS",
    "LIBSQL_URL",
    "LIBSQL_AUTH_TOKEN",
  ] as const;

  beforeEach(() => {
    // Clean up test env vars before each test
    for (const key of testEnvVars) {
      delete Bun.env[key];
    }
  });

  describe("initConfig", () => {
    it("should initialize with workerDirs from options", () => {
      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp/apps"] });
      expect(result.workerDirs).toContain("/tmp/apps");
    });

    it("should resolve relative workerDirs paths against baseDir", () => {
      const result = initConfig({
        baseDir: "/base",
        libsqlUrl: "http://localhost:8880",
        workerDirs: ["./apps"],
      });
      expect(result.workerDirs).toContain("/base/apps");
    });

    it("should throw when workerDirs is empty", () => {
      expect(() => initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: [] })).toThrow(
        /workerDirs is required/,
      );
    });

    it("should use WORKER_DIRS env var when not in options", () => {
      Bun.env.WORKER_DIRS = "/env/apps";
      Bun.env.LIBSQL_URL = "http://localhost:8880";

      const result = initConfig();
      expect(result.workerDirs).toContain("/env/apps");
    });

    it("should handle comma-separated WORKER_DIRS", () => {
      Bun.env.WORKER_DIRS = "/app1,/app2,/app3";
      Bun.env.LIBSQL_URL = "http://localhost:8880";

      const result = initConfig();
      expect(result.workerDirs).toContain("/app1");
      expect(result.workerDirs).toContain("/app2");
      expect(result.workerDirs).toContain("/app3");
    });

    it("should use POOL_SIZE env var", () => {
      Bun.env.POOL_SIZE = "100";

      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp"] });
      expect(result.poolSize).toBe(100);
    });

    it("should use default poolSize for environment", () => {
      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp"] });
      // Default for test environment is 5
      expect(result.poolSize).toBe(5);
    });

    it("should handle invalid POOL_SIZE gracefully", () => {
      Bun.env.POOL_SIZE = "invalid";

      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp"] });
      expect(result.poolSize).toBeGreaterThan(0);
    });

    it("should use HOMEPAGE_APP env var", () => {
      Bun.env.HOMEPAGE_APP = "my-app";

      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp"] });
      expect(result.homepage).toBe("my-app");
    });

    it("should use default body size limits", () => {
      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp"] });
      expect(result.bodySize.default).toBe(BodySizeLimits.DEFAULT);
      expect(result.bodySize.max).toBe(BodySizeLimits.MAX);
    });

    it("should include static config values", () => {
      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp"] });
      expect(typeof result.delayMs).toBe("number");
      expect(typeof result.isCompiled).toBe("boolean");
      expect(typeof result.isDev).toBe("boolean");
      expect(typeof result.nodeEnv).toBe("string");
      expect(typeof result.port).toBe("number");
      expect(typeof result.version).toBe("string");
    });

    it("should throw when LIBSQL_URL is not set", () => {
      expect(() => initConfig({ workerDirs: ["/tmp"] })).toThrow(/LIBSQL_URL.*required/);
    });

    it("should use libsqlUrl from options", () => {
      const result = initConfig({ libsqlUrl: "http://localhost:8880", workerDirs: ["/tmp"] });
      expect(result.libsqlUrl).toBe("http://localhost:8880");
    });

    it("should use LIBSQL_URL env var", () => {
      Bun.env.LIBSQL_URL = "http://localhost:8880";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.libsqlUrl).toBe("http://localhost:8880");
    });

    it("should use LIBSQL_AUTH_TOKEN env var", () => {
      Bun.env.LIBSQL_URL = "http://localhost:8880";
      Bun.env.LIBSQL_AUTH_TOKEN = "my-token";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.libsqlAuthToken).toBe("my-token");
    });

    it("should use default pluginDirs", () => {
      Bun.env.LIBSQL_URL = "http://localhost:8880";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.pluginDirs.length).toBeGreaterThan(0);
    });

    it("should use PLUGIN_DIRS env var", () => {
      Bun.env.LIBSQL_URL = "http://localhost:8880";
      Bun.env.PLUGIN_DIRS = "/custom/plugins";

      const result = initConfig({ workerDirs: ["/tmp"] });
      expect(result.pluginDirs).toContain("/custom/plugins");
    });
  });

  describe("getConfig", () => {
    it("should return initialized config", () => {
      Bun.env.LIBSQL_URL = "http://localhost:8880";

      initConfig({ workerDirs: ["/tmp"] });
      const result = getConfig();

      expect(result.workerDirs).toContain("/tmp");
    });
  });
});
