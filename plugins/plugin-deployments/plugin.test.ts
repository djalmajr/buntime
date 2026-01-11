import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { MenuItem, PluginContext, PluginLogger } from "@buntime/shared/types";
import deploymentsPlugin from "./plugin";
import { getDirNames, getExcludes, getWorkerDirs, setExcludes, setWorkerDirs } from "./server/api";

/**
 * Create a mock PluginContext for testing onInit
 */
function createMockContext(overrides: Partial<PluginContext> = {}): PluginContext {
  const mockLogger: PluginLogger = {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  };

  return {
    config: {},
    globalConfig: {
      workerDirs: ["./apps"],
      poolSize: 100,
    },
    logger: mockLogger,
    pool: undefined,
    registerService: () => {},
    getService: () => undefined,
    ...overrides,
  };
}

describe("deploymentsPlugin", () => {
  describe("plugin structure", () => {
    it("should return a valid plugin object with implementation properties", () => {
      const plugin = deploymentsPlugin();

      expect(plugin.routes).toBeDefined();
      expect(typeof plugin.onInit).toBe("function");
    });
  });

  describe("plugin configuration", () => {
    it("should accept empty config", () => {
      const plugin = deploymentsPlugin();

      expect(plugin).toBeDefined();
    });

    it("should accept config with excludes", () => {
      const plugin = deploymentsPlugin({ excludes: ["dist", ".cache"] });

      expect(plugin).toBeDefined();
    });

    it("should accept config with workerDirs", () => {
      const plugin = deploymentsPlugin({ workerDirs: ["./custom-apps"] });

      expect(plugin).toBeDefined();
    });

    it("should accept config with both excludes and workerDirs", () => {
      const plugin = deploymentsPlugin({
        workerDirs: ["./apps", "./packages"],
        excludes: ["dist"],
      });

      expect(plugin).toBeDefined();
    });
  });

  describe("onInit", () => {
    const originalWorkerDirs = getWorkerDirs();
    const originalExcludes = getExcludes();

    beforeEach(() => {
      // Reset state before each test
      setWorkerDirs(["./apps"]);
      setExcludes([".git", "node_modules"], true);
    });

    afterEach(() => {
      // Restore original state
      setWorkerDirs(originalWorkerDirs);
      setExcludes(originalExcludes, true);
    });

    it("should use global config workerDirs when plugin config has no workerDirs", () => {
      const plugin = deploymentsPlugin();
      const ctx = createMockContext({
        globalConfig: {
          workerDirs: ["./global-apps", "./global-packages"],
          poolSize: 100,
        },
      });

      plugin.onInit!(ctx);

      expect(getWorkerDirs()).toEqual(["./global-apps", "./global-packages"]);
    });

    it("should use plugin config workerDirs when provided", () => {
      const plugin = deploymentsPlugin({ workerDirs: ["./plugin-apps"] });
      const ctx = createMockContext({
        config: { workerDirs: ["./plugin-apps"] },
      });

      plugin.onInit!(ctx);

      expect(getWorkerDirs()).toEqual(["./plugin-apps"]);
    });

    it("should fallback to default workerDirs when both global and plugin config are undefined", () => {
      const plugin = deploymentsPlugin();
      const ctx = createMockContext({
        globalConfig: {
          workerDirs: undefined as unknown as string[],
          poolSize: 100,
        },
      });

      plugin.onInit!(ctx);

      expect(getWorkerDirs()).toEqual(["./apps"]);
    });

    it("should set excludes from plugin config", () => {
      const plugin = deploymentsPlugin({ excludes: ["dist", ".cache"] });
      const ctx = createMockContext({
        config: { excludes: ["dist", ".cache"] },
      });

      plugin.onInit!(ctx);

      const excludes = getExcludes();
      expect(excludes).toContain("dist");
      expect(excludes).toContain(".cache");
      expect(excludes).toContain(".git");
      expect(excludes).toContain("node_modules");
    });

    it("should not modify excludes if plugin config has no excludes", () => {
      setExcludes([".git", "node_modules"], true);

      const plugin = deploymentsPlugin();
      const ctx = createMockContext();

      plugin.onInit!(ctx);

      expect(getExcludes()).toEqual([".git", "node_modules"]);
    });

    it("should set BUNTIME_EXCLUDES environment variable", () => {
      const plugin = deploymentsPlugin({ excludes: ["dist"] });
      const ctx = createMockContext({
        config: { excludes: ["dist"] },
      });

      plugin.onInit!(ctx);

      expect(Bun.env.BUNTIME_EXCLUDES).toBeDefined();
      const envExcludes = JSON.parse(Bun.env.BUNTIME_EXCLUDES!);
      expect(envExcludes).toContain("dist");
    });

    it("should log initialization message", () => {
      const infoSpy = spyOn({ info: () => {} }, "info");
      const plugin = deploymentsPlugin();
      const ctx = createMockContext({
        logger: {
          debug: () => {},
          error: () => {},
          info: infoSpy,
          warn: () => {},
        },
      });

      plugin.onInit!(ctx);

      expect(infoSpy).toHaveBeenCalled();
    });

    it("should generate submenu items for multiple workerDirs when menus provided", () => {
      const menus: MenuItem[] = [
        { icon: "lucide:rocket", path: "/deployments", priority: 10, title: "Deployments" },
      ];
      const plugin = deploymentsPlugin({ menus });
      const ctx = createMockContext({
        globalConfig: {
          workerDirs: ["./apps", "./packages", "./examples"],
          poolSize: 100,
        },
      });

      plugin.onInit!(ctx);

      // The menus array passed to the factory should be modified
      expect(menus[0]!.items).toBeDefined();
      expect(menus[0]!.items).toHaveLength(3);
      expect(menus[0]!.items![0]!.path).toBe("/deployments/apps");
      expect(menus[0]!.items![1]!.path).toBe("/deployments/packages");
      expect(menus[0]!.items![2]!.path).toBe("/deployments/examples");
    });

    it("should not add submenu items for single workerDir", () => {
      const menus: MenuItem[] = [
        { icon: "lucide:rocket", path: "/deployments", priority: 10, title: "Deployments" },
      ];
      const plugin = deploymentsPlugin({ menus });
      const ctx = createMockContext({
        globalConfig: {
          workerDirs: ["./apps"],
          poolSize: 100,
        },
      });

      plugin.onInit!(ctx);

      // Single directory should not have submenu items
      expect(menus[0]!.items).toBeUndefined();
    });

  });
});

describe("api exports", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeEach(() => {
    // Reset to defaults before each test
    setWorkerDirs(["./apps"]);
    setExcludes([".git", "node_modules"], true);
  });

  afterEach(() => {
    // Restore original state
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  describe("setWorkerDirs / getWorkerDirs", () => {
    it("should set and get workerDirs", () => {
      setWorkerDirs(["./apps", "./packages"]);

      expect(getWorkerDirs()).toEqual(["./apps", "./packages"]);
    });

    it("should handle single workerDir", () => {
      setWorkerDirs(["./my-apps"]);

      expect(getWorkerDirs()).toEqual(["./my-apps"]);
    });

    it("should handle empty array", () => {
      setWorkerDirs([]);

      expect(getWorkerDirs()).toEqual([]);
    });
  });

  describe("getDirNames", () => {
    it("should return directory names from workerDirs", () => {
      setWorkerDirs(["./apps", "./packages"]);

      const dirNames = getDirNames();

      expect(dirNames).toContain("apps");
      expect(dirNames).toContain("packages");
    });

    it("should handle duplicate directory names with suffix", () => {
      setWorkerDirs(["./folder/apps", "./other/apps"]);

      const dirNames = getDirNames();

      expect(dirNames).toContain("apps");
      expect(dirNames).toContain("apps-2");
    });

    it("should handle multiple duplicates", () => {
      setWorkerDirs(["./a/test", "./b/test", "./c/test"]);

      const dirNames = getDirNames();

      expect(dirNames).toEqual(["test", "test-2", "test-3"]);
    });
  });

  describe("setExcludes / getExcludes", () => {
    it("should get default excludes", () => {
      setExcludes([".git", "node_modules"], true);

      expect(getExcludes()).toEqual([".git", "node_modules"]);
    });

    it("should add to default excludes", () => {
      setExcludes([".git", "node_modules"], true);
      setExcludes(["dist", ".cache"]);

      const excludes = getExcludes();

      expect(excludes).toContain(".git");
      expect(excludes).toContain("node_modules");
      expect(excludes).toContain("dist");
      expect(excludes).toContain(".cache");
    });

    it("should replace excludes when replace=true", () => {
      setExcludes(["custom-exclude"], true);

      expect(getExcludes()).toEqual(["custom-exclude"]);
    });

    it("should deduplicate excludes", () => {
      setExcludes([".git", "node_modules"], true);
      setExcludes([".git", "dist"]);

      const excludes = getExcludes();
      const gitCount = excludes.filter((e) => e === ".git").length;

      expect(gitCount).toBe(1);
    });
  });
});
