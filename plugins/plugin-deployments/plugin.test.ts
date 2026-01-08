import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { PluginContext, PluginLogger } from "@buntime/shared/types";
import deploymentsPlugin from "./plugin";
import { getDirNames, getExcludes, getWorkspaces, setExcludes, setWorkspaces } from "./server/api";

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
      poolSize: 100,
      workspaces: ["./apps"],
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
    it("should return a valid plugin object", () => {
      const plugin = deploymentsPlugin();

      expect(plugin.name).toBe("@buntime/plugin-deployments");
      expect(plugin.base).toBe("/deployments");
      expect(plugin.routes).toBeDefined();
      expect(plugin.fragment).toEqual({ type: "patch" });
      expect(plugin.menus).toBeDefined();
      expect(Array.isArray(plugin.menus)).toBe(true);
    });

    it("should have correct menu structure", () => {
      const plugin = deploymentsPlugin();

      expect(plugin.menus).toHaveLength(1);
      expect(plugin.menus?.[0]).toEqual({
        icon: "lucide:rocket",
        path: "/deployments",
        priority: 10,
        title: "Deployments",
      });
    });

    it("should have onInit function", () => {
      const plugin = deploymentsPlugin();

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

    it("should accept config with workspaces", () => {
      const plugin = deploymentsPlugin({ workspaces: ["./custom-apps"] });

      expect(plugin).toBeDefined();
    });

    it("should accept config with both excludes and workspaces", () => {
      const plugin = deploymentsPlugin({
        excludes: ["dist"],
        workspaces: ["./apps", "./packages"],
      });

      expect(plugin).toBeDefined();
    });
  });

  describe("onInit", () => {
    const originalWorkspaces = getWorkspaces();
    const originalExcludes = getExcludes();

    beforeEach(() => {
      // Reset state before each test
      setWorkspaces(["./apps"]);
      setExcludes([".git", "node_modules"], true);
    });

    afterEach(() => {
      // Restore original state
      setWorkspaces(originalWorkspaces);
      setExcludes(originalExcludes, true);
    });

    it("should use global config workspaces when plugin config has no workspaces", () => {
      const plugin = deploymentsPlugin();
      const ctx = createMockContext({
        globalConfig: {
          poolSize: 100,
          workspaces: ["./global-apps", "./global-packages"],
        },
      });

      plugin.onInit!(ctx);

      expect(getWorkspaces()).toEqual(["./global-apps", "./global-packages"]);
    });

    it("should use plugin config workspaces when provided", () => {
      const plugin = deploymentsPlugin({ workspaces: ["./plugin-apps"] });
      const ctx = createMockContext({
        config: { workspaces: ["./plugin-apps"] },
      });

      plugin.onInit!(ctx);

      expect(getWorkspaces()).toEqual(["./plugin-apps"]);
    });

    it("should fallback to default workspaces when both global and plugin config are undefined", () => {
      const plugin = deploymentsPlugin();
      const ctx = createMockContext({
        globalConfig: {
          poolSize: 100,
          workspaces: undefined as unknown as string[],
        },
      });

      plugin.onInit!(ctx);

      expect(getWorkspaces()).toEqual(["./apps"]);
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

    it("should not add submenu items when only one directory", () => {
      const plugin = deploymentsPlugin({ workspaces: ["./apps"] });
      const ctx = createMockContext({
        config: { workspaces: ["./apps"] },
      });

      plugin.onInit!(ctx);

      expect(plugin.menus?.[0]?.items).toBeUndefined();
    });

    it("should add submenu items when multiple directories", () => {
      const plugin = deploymentsPlugin({ workspaces: ["./apps", "./packages"] });
      const ctx = createMockContext({
        config: { workspaces: ["./apps", "./packages"] },
      });

      plugin.onInit!(ctx);

      expect(plugin.menus?.[0]?.items).toHaveLength(2);
      expect(plugin.menus?.[0]?.items?.[0]).toEqual({
        icon: "lucide:folder",
        path: "/deployments/apps",
        title: "apps",
      });
      expect(plugin.menus?.[0]?.items?.[1]).toEqual({
        icon: "lucide:folder",
        path: "/deployments/packages",
        title: "packages",
      });
    });

    it("should handle duplicate directory names in submenu", () => {
      const plugin = deploymentsPlugin({ workspaces: ["./a/apps", "./b/apps", "./c/apps"] });
      const ctx = createMockContext({
        config: { workspaces: ["./a/apps", "./b/apps", "./c/apps"] },
      });

      plugin.onInit!(ctx);

      expect(plugin.menus?.[0]?.items).toHaveLength(3);
      expect(plugin.menus?.[0]?.items?.[0]?.title).toBe("apps");
      expect(plugin.menus?.[0]?.items?.[1]?.title).toBe("apps-2");
      expect(plugin.menus?.[0]?.items?.[2]?.title).toBe("apps-3");
    });
  });
});

describe("api exports", () => {
  const originalWorkspaces = getWorkspaces();
  const originalExcludes = getExcludes();

  beforeEach(() => {
    // Reset to defaults before each test
    setWorkspaces(["./apps"]);
    setExcludes([".git", "node_modules"], true);
  });

  afterEach(() => {
    // Restore original state
    setWorkspaces(originalWorkspaces);
    setExcludes(originalExcludes, true);
  });

  describe("setWorkspaces / getWorkspaces", () => {
    it("should set and get workspaces", () => {
      setWorkspaces(["./apps", "./packages"]);

      expect(getWorkspaces()).toEqual(["./apps", "./packages"]);
    });

    it("should handle single workspace", () => {
      setWorkspaces(["./my-apps"]);

      expect(getWorkspaces()).toEqual(["./my-apps"]);
    });

    it("should handle empty array", () => {
      setWorkspaces([]);

      expect(getWorkspaces()).toEqual([]);
    });
  });

  describe("getDirNames", () => {
    it("should return directory names from workspaces", () => {
      setWorkspaces(["./apps", "./packages"]);

      const dirNames = getDirNames();

      expect(dirNames).toContain("apps");
      expect(dirNames).toContain("packages");
    });

    it("should handle duplicate directory names with suffix", () => {
      setWorkspaces(["./folder/apps", "./other/apps"]);

      const dirNames = getDirNames();

      expect(dirNames).toContain("apps");
      expect(dirNames).toContain("apps-2");
    });

    it("should handle multiple duplicates", () => {
      setWorkspaces(["./a/test", "./b/test", "./c/test"]);

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
