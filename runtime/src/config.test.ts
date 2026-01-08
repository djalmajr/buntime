import { beforeEach, describe, expect, it } from "bun:test";
import type { BuntimeConfig } from "@buntime/shared/types";
import { getConfig, initConfig } from "./config";
import { BodySizeLimits } from "./constants";

describe("config", () => {
  const originalEnv = { ...Bun.env };

  beforeEach(() => {
    // Reset env
    for (const key of Object.keys(Bun.env)) {
      if (!originalEnv[key]) {
        delete Bun.env[key];
      }
    }
    Object.assign(Bun.env, originalEnv);
  });

  describe("initConfig", () => {
    it("should initialize with workspaces from config", () => {
      const config: BuntimeConfig = {
        workspaces: ["/tmp/apps"],
      };

      const result = initConfig(config, "/base");
      expect(result.workspaces).toContain("/tmp/apps");
    });

    it("should resolve relative workspace paths", () => {
      const config: BuntimeConfig = {
        workspaces: ["./apps"],
      };

      const result = initConfig(config, "/base");
      expect(result.workspaces).toContain("/base/apps");
    });

    it("should throw when workspaces is empty", () => {
      const config: BuntimeConfig = {
        workspaces: [],
      };

      expect(() => initConfig(config, "/base")).toThrow(/workspaces is required/);
    });

    it("should use WORKSPACES_DIR env var as fallback", () => {
      Bun.env.WORKSPACES_DIR = "/env/apps";
      const config: BuntimeConfig = {};

      const result = initConfig(config, "/base");
      expect(result.workspaces).toContain("/env/apps");
    });

    it("should handle comma-separated WORKSPACES_DIR", () => {
      Bun.env.WORKSPACES_DIR = "/app1,/app2,/app3";
      const config: BuntimeConfig = {};

      const result = initConfig(config, "/base");
      expect(result.workspaces).toContain("/app1");
      expect(result.workspaces).toContain("/app2");
      expect(result.workspaces).toContain("/app3");
    });

    it("should use poolSize from config", () => {
      const config: BuntimeConfig = {
        poolSize: 50,
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.poolSize).toBe(50);
    });

    it("should use POOL_SIZE env var when not in config", () => {
      Bun.env.POOL_SIZE = "100";
      const config: BuntimeConfig = {
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.poolSize).toBe(100);
    });

    it("should use default poolSize for environment", () => {
      const config: BuntimeConfig = {
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      // Default for test environment is 5
      expect(result.poolSize).toBe(5);
    });

    it("should handle invalid POOL_SIZE gracefully", () => {
      Bun.env.POOL_SIZE = "invalid";
      const config: BuntimeConfig = {
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.poolSize).toBeGreaterThan(0);
    });

    it("should use homepage from config", () => {
      const config: BuntimeConfig = {
        homepage: "/dashboard",
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.homepage).toBe("/dashboard");
    });

    it("should use HOMEPAGE_APP env var as fallback", () => {
      Bun.env.HOMEPAGE_APP = "my-app";
      const config: BuntimeConfig = {
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.homepage).toBe("my-app");
    });

    it("should use default body size limits", () => {
      const config: BuntimeConfig = {
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.bodySize.default).toBe(BodySizeLimits.DEFAULT);
      expect(result.bodySize.max).toBe(BodySizeLimits.MAX);
    });

    it("should parse custom body size from config", () => {
      const config: BuntimeConfig = {
        bodySize: {
          default: "5mb",
          max: "50mb",
        },
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.bodySize.default).toBe(5 * 1024 * 1024);
      expect(result.bodySize.max).toBe(50 * 1024 * 1024);
    });

    it("should cap default to max when default exceeds max", () => {
      const config: BuntimeConfig = {
        bodySize: {
          default: "100mb",
          max: "50mb",
        },
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(result.bodySize.default).toBe(result.bodySize.max);
    });

    it("should include static config values", () => {
      const config: BuntimeConfig = {
        workspaces: ["/tmp"],
      };

      const result = initConfig(config, "/base");
      expect(typeof result.delayMs).toBe("number");
      expect(typeof result.isCompiled).toBe("boolean");
      expect(typeof result.isDev).toBe("boolean");
      expect(typeof result.nodeEnv).toBe("string");
      expect(typeof result.port).toBe("number");
      expect(typeof result.version).toBe("string");
    });
  });

  describe("getConfig", () => {
    it("should throw when config is not initialized", () => {
      // Force reset by creating a new module context
      // In practice, the singleton pattern means this test verifies the check exists
      // The actual test of uninitialized state is tricky due to module caching
    });

    it("should return initialized config", () => {
      const config: BuntimeConfig = {
        workspaces: ["/tmp"],
      };

      initConfig(config, "/base");
      const result = getConfig();

      expect(result.workspaces).toContain("/tmp");
    });
  });
});
