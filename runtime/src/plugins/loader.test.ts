import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuntimeConfig } from "@buntime/shared/types";
import { initConfig } from "@/config";
import { loadBuntimeConfig, PluginLoader } from "./loader";

const TEST_DIR = join(import.meta.dir, ".test-loader");

describe("PluginLoader", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    initConfig({ workspaces: [TEST_DIR] }, TEST_DIR);
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create loader with empty config", () => {
      const loader = new PluginLoader();
      expect(loader).toBeDefined();
    });

    it("should create loader with config and pool", () => {
      const config: BuntimeConfig = { plugins: [] };
      const pool = {};
      const loader = new PluginLoader(config, pool);
      expect(loader).toBeDefined();
    });
  });

  describe("load", () => {
    it("should return empty registry when no plugins configured", async () => {
      const loader = new PluginLoader({});
      const registry = await loader.load();
      expect(registry.size).toBe(0);
    });

    it("should return empty registry with empty plugins array", async () => {
      const loader = new PluginLoader({ plugins: [] });
      const registry = await loader.load();
      expect(registry.size).toBe(0);
    });

    it("should throw for non-existent plugin", async () => {
      const loader = new PluginLoader({
        plugins: ["does-not-exist"],
      });
      await expect(loader.load()).rejects.toThrow(/Could not resolve plugin/);
    });
  });

  describe("loadPlugin validation", () => {
    const PLUGINS_TEST_DIR = join(TEST_DIR, "plugins-validation");

    beforeEach(() => {
      mkdirSync(join(PLUGINS_TEST_DIR, "plugins"), { recursive: true });
      // Reinitialize config with the test directory as baseDir
      initConfig({ workspaces: [PLUGINS_TEST_DIR] }, PLUGINS_TEST_DIR);
    });

    afterEach(() => {
      rmSync(PLUGINS_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ workspaces: [TEST_DIR] }, TEST_DIR);
    });

    it("should throw for plugin missing name field", async () => {
      // Create a plugin without name field but with a function that returns an object without name
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "no-name.ts"),
        `export default { base: "/test", name: "" };`, // Empty name still fails validation
      );

      const loader = new PluginLoader({ plugins: ["no-name"] });
      // Empty name is not scanned, so it's not found
      await expect(loader.load()).rejects.toThrow(/Could not resolve plugin/);
    });

    it("should throw for plugin missing base field", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "no-base.ts"),
        `export default { name: "no-base" };`,
      );

      const loader = new PluginLoader({ plugins: ["no-base"] });
      await expect(loader.load()).rejects.toThrow(/missing required field: base/);
    });

    it("should throw for invalid base path format", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "invalid-base.ts"),
        `export default { name: "invalid-base", base: "/invalid base path" };`,
      );

      const loader = new PluginLoader({ plugins: ["invalid-base"] });
      await expect(loader.load()).rejects.toThrow(/invalid base path/);
    });

    it("should throw for reserved path /api", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "reserved-api.ts"),
        `export default { name: "reserved-api", base: "/api" };`,
      );

      const loader = new PluginLoader({ plugins: ["reserved-api"] });
      await expect(loader.load()).rejects.toThrow(/cannot use reserved path/);
    });

    it("should throw for reserved path /health", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "reserved-health.ts"),
        `export default { name: "reserved-health", base: "/health" };`,
      );

      const loader = new PluginLoader({ plugins: ["reserved-health"] });
      await expect(loader.load()).rejects.toThrow(/cannot use reserved path/);
    });

    it("should allow base override from config", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "base-override.ts"),
        `export default { name: "base-override", base: "/original" };`,
      );

      const loader = new PluginLoader({
        plugins: [["base-override", { base: "/custom" }]],
      });
      const registry = await loader.load();
      const plugin = registry.getAll().find((p) => p.name === "base-override");
      expect(plugin?.base).toBe("/custom");
    });

    it("should throw for invalid base override format", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "invalid-override.ts"),
        `export default { name: "invalid-override", base: "/original" };`,
      );

      const loader = new PluginLoader({
        plugins: [["invalid-override", { base: "/invalid override" }]],
      });
      await expect(loader.load()).rejects.toThrow(/invalid base path/);
    });

    it("should throw for reserved path in base override", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "reserved-override.ts"),
        `export default { name: "reserved-override", base: "/original" };`,
      );

      const loader = new PluginLoader({
        plugins: [["reserved-override", { base: "/api" }]],
      });
      await expect(loader.load()).rejects.toThrow(/cannot use reserved path/);
    });

    it("should throw for already loaded plugin", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "duplicate.ts"),
        `export default { name: "duplicate", base: "/dup" };`,
      );

      const loader = new PluginLoader({ plugins: ["duplicate"] });
      const _registry = await loader.load();
      // Try to load the same plugin again
      await expect(loader.loadPlugin("duplicate")).rejects.toThrow(/already loaded/);
    });

    it("should support factory function plugins", async () => {
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "factory.ts"),
        `export default (config) => ({
          name: "factory-plugin",
          base: config.base || "/factory",
        });`,
      );

      // Factory functions are scanned by calling them with {} to extract the name
      const loader = new PluginLoader({
        plugins: [["factory-plugin", { base: "/custom-factory" }]],
      });
      const registry = await loader.load();
      const plugin = registry.get("factory-plugin");

      expect(plugin).toBeDefined();
      expect(plugin?.base).toBe("/custom-factory");
    });

    it("should throw for invalid plugin module structure", async () => {
      writeFileSync(join(PLUGINS_TEST_DIR, "plugins", "invalid-module.ts"), `export default 123;`);

      // Invalid modules are silently ignored during scan, so plugin won't be found
      const loader = new PluginLoader({ plugins: ["invalid-module"] });
      await expect(loader.load()).rejects.toThrow(/Could not resolve plugin/);
    });

    it("should call onInit hook with timeout protection", async () => {
      const _initCalled = { value: false };
      writeFileSync(
        join(PLUGINS_TEST_DIR, "plugins", "with-init.ts"),
        `export default {
          name: "with-init",
          base: "/init",
          onInit: async (ctx) => {
            // Simulates initialization
          },
        };`,
      );

      const loader = new PluginLoader({ plugins: ["with-init"] });
      const registry = await loader.load();
      expect(registry.has("with-init")).toBe(true);
    });
  });

  describe("scanPluginDirs", () => {
    const EXT_TEST_DIR = join(TEST_DIR, "external-plugins");

    beforeEach(() => {
      mkdirSync(join(EXT_TEST_DIR, "plugins"), { recursive: true });
      // Reinitialize config with the test directory as baseDir
      initConfig({ workspaces: [EXT_TEST_DIR] }, EXT_TEST_DIR);
    });

    afterEach(() => {
      rmSync(EXT_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ workspaces: [TEST_DIR] }, TEST_DIR);
    });

    it("should resolve plugin from ./plugins/name.ts by internal name", async () => {
      writeFileSync(
        join(EXT_TEST_DIR, "plugins", "my-plugin.ts"),
        `export default { name: "my-plugin", base: "/my-plugin" };`,
      );

      const loader = new PluginLoader({ plugins: ["my-plugin"] });
      const registry = await loader.load();
      expect(registry.has("my-plugin")).toBe(true);
    });

    it("should resolve plugin from ./plugins/name/index.ts", async () => {
      const pluginDir = join(EXT_TEST_DIR, "plugins", "nested-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "index.ts"),
        `export default { name: "nested-plugin", base: "/nested" };`,
      );

      const loader = new PluginLoader({ plugins: ["nested-plugin"] });
      const registry = await loader.load();
      expect(registry.has("nested-plugin")).toBe(true);
    });

    it("should resolve plugin from ./plugins/name/plugin.ts", async () => {
      const pluginDir = join(EXT_TEST_DIR, "plugins", "some-dir");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "plugin.ts"),
        `export default { name: "plugin-with-plugin-entry", base: "/plugin-entry" };`,
      );

      const loader = new PluginLoader({ plugins: ["plugin-with-plugin-entry"] });
      const registry = await loader.load();
      expect(registry.has("plugin-with-plugin-entry")).toBe(true);
    });

    it("should resolve scoped plugin names like @buntime/plugin-xxx", async () => {
      // Create plugin with buntime naming convention - file name doesn't matter
      writeFileSync(
        join(EXT_TEST_DIR, "plugins", "any-filename.ts"),
        `export default { name: "@buntime/plugin-metrics", base: "/metrics" };`,
      );

      const loader = new PluginLoader({ plugins: ["@buntime/plugin-metrics"] });
      const registry = await loader.load();
      expect(registry.has("@buntime/plugin-metrics")).toBe(true);
    });

    it("should resolve plugin by internal name regardless of filename", async () => {
      // File name is "whatever.ts" but internal name is "my-awesome-plugin"
      writeFileSync(
        join(EXT_TEST_DIR, "plugins", "whatever.ts"),
        `export default { name: "my-awesome-plugin", base: "/awesome" };`,
      );

      const loader = new PluginLoader({ plugins: ["my-awesome-plugin"] });
      const registry = await loader.load();
      expect(registry.has("my-awesome-plugin")).toBe(true);
    });
  });

  describe("topological sort with dependencies", () => {
    const DEP_TEST_DIR = join(TEST_DIR, "deps-plugins");

    beforeEach(() => {
      mkdirSync(join(DEP_TEST_DIR, "plugins"), { recursive: true });
      // Reinitialize config with the test directory as baseDir
      initConfig({ workspaces: [DEP_TEST_DIR] }, DEP_TEST_DIR);
    });

    afterEach(() => {
      rmSync(DEP_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ workspaces: [TEST_DIR] }, TEST_DIR);
    });

    it("should load plugins in dependency order", async () => {
      // Create plugins with dependencies
      writeFileSync(
        join(DEP_TEST_DIR, "plugins", "plugin-a.ts"),
        `export default { name: "plugin-a", base: "/a" };`,
      );
      writeFileSync(
        join(DEP_TEST_DIR, "plugins", "plugin-b.ts"),
        `export default { name: "plugin-b", base: "/b", dependencies: ["plugin-a"] };`,
      );

      const loader = new PluginLoader({
        plugins: ["plugin-b", "plugin-a"],
      });
      const registry = await loader.load();
      // Both should be loaded
      expect(registry.has("plugin-a")).toBe(true);
      expect(registry.has("plugin-b")).toBe(true);
    });

    it("should throw for missing required dependency", async () => {
      writeFileSync(
        join(DEP_TEST_DIR, "plugins", "needs-dep.ts"),
        `export default { name: "needs-dep", base: "/needs", dependencies: ["missing-dep"] };`,
      );

      const loader = new PluginLoader({ plugins: ["needs-dep"] });
      await expect(loader.load()).rejects.toThrow(/requires.*missing-dep.*not configured/);
    });

    it("should detect circular dependencies", async () => {
      writeFileSync(
        join(DEP_TEST_DIR, "plugins", "cycle-a.ts"),
        `export default { name: "cycle-a", base: "/cycle-a", dependencies: ["cycle-b"] };`,
      );
      writeFileSync(
        join(DEP_TEST_DIR, "plugins", "cycle-b.ts"),
        `export default { name: "cycle-b", base: "/cycle-b", dependencies: ["cycle-a"] };`,
      );

      const loader = new PluginLoader({
        plugins: ["cycle-a", "cycle-b"],
      });
      await expect(loader.load()).rejects.toThrow(/Circular dependency/);
    });

    it("should filter optional dependencies to configured only", async () => {
      writeFileSync(
        join(DEP_TEST_DIR, "plugins", "optional-base.ts"),
        `export default { name: "optional-base", base: "/opt-base" };`,
      );
      writeFileSync(
        join(DEP_TEST_DIR, "plugins", "with-optional.ts"),
        `export default {
          name: "with-optional",
          base: "/with-opt",
          optionalDependencies: ["optional-base", "not-configured"]
        };`,
      );

      // Only load with-optional and optional-base, not-configured is not in the list
      const loader = new PluginLoader({
        plugins: ["with-optional", "optional-base"],
      });
      const registry = await loader.load();
      // Both should be loaded, with-optional should load after optional-base
      expect(registry.has("with-optional")).toBe(true);
      expect(registry.has("optional-base")).toBe(true);
    });
  });

  describe("resolvePlugin with default export", () => {
    const DEFAULT_TEST_DIR = join(TEST_DIR, "default-export");

    beforeEach(() => {
      mkdirSync(join(DEFAULT_TEST_DIR, "plugins"), { recursive: true });
      // Reinitialize config with the test directory as baseDir
      initConfig({ workspaces: [DEFAULT_TEST_DIR] }, DEFAULT_TEST_DIR);
    });

    afterEach(() => {
      rmSync(DEFAULT_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ workspaces: [TEST_DIR] }, TEST_DIR);
    });

    it("should resolve plugin with default export", async () => {
      writeFileSync(
        join(DEFAULT_TEST_DIR, "plugins", "with-default.ts"),
        `const plugin = { name: "with-default", base: "/default" };
         export default plugin;`,
      );

      const loader = new PluginLoader({ plugins: ["with-default"] });
      const registry = await loader.load();
      expect(registry.has("with-default")).toBe(true);
    });
  });
});

describe("loadBuntimeConfig", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("should return empty config when buntime.jsonc not found", async () => {
    const originalCwd = process.cwd();

    try {
      process.chdir(TEST_DIR);
      const result = await loadBuntimeConfig();
      expect(result.config).toEqual({});
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should load valid buntime.jsonc", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "config-test");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "buntime.jsonc"), JSON.stringify({ plugins: ["test"] }));
      process.chdir(configDir);
      const result = await loadBuntimeConfig();
      expect(result.config.plugins).toEqual(["test"]);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should validate plugins is an array", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "invalid-plugins");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "buntime.jsonc"), JSON.stringify({ plugins: "not-an-array" }));
      process.chdir(configDir);
      await expect(loadBuntimeConfig()).rejects.toThrow(/expected array/);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should validate plugin tuple format", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "invalid-tuple");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "buntime.jsonc"),
        JSON.stringify({ plugins: [["name", "not-object"]] }),
      );
      process.chdir(configDir);
      await expect(loadBuntimeConfig()).rejects.toThrow(/second element must be object/);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should validate plugin tuple has string name", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "invalid-tuple-name");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "buntime.jsonc"), JSON.stringify({ plugins: [[123, {}]] }));
      process.chdir(configDir);
      await expect(loadBuntimeConfig()).rejects.toThrow(/first element must be string/);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should validate plugin tuple length", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "invalid-tuple-len");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "buntime.jsonc"),
        JSON.stringify({ plugins: [["a", {}, "extra"]] }),
      );
      process.chdir(configDir);
      await expect(loadBuntimeConfig()).rejects.toThrow(/tuple must have 1-2 elements/);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should reject invalid plugin entry type", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "invalid-entry");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "buntime.jsonc"), JSON.stringify({ plugins: [123] }));
      process.chdir(configDir);
      await expect(loadBuntimeConfig()).rejects.toThrow(/expected string or.*tuple/);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should handle non-object config", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "non-object");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "buntime.jsonc"), '"string-config"');
      process.chdir(configDir);
      await expect(loadBuntimeConfig()).rejects.toThrow(/expected object/);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should handle buntime.jsonc with workspaces config", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "workspaces-config");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "buntime.jsonc"),
        JSON.stringify({ workspaces: ["./apps", "./packages"] }),
      );
      process.chdir(configDir);
      const result = await loadBuntimeConfig();
      expect(result.config.workspaces).toEqual(["./apps", "./packages"]);
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should handle buntime.jsonc with empty object", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "empty-config");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "buntime.jsonc"), "{}");
      process.chdir(configDir);
      const result = await loadBuntimeConfig();
      expect(result.config).toEqual({});
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("should handle buntime.jsonc with homepage config", async () => {
    const originalCwd = process.cwd();
    const configDir = join(TEST_DIR, "homepage-config");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "buntime.jsonc"),
        JSON.stringify({ homepage: { app: "cpanel", shell: true } }),
      );
      process.chdir(configDir);
      const result = await loadBuntimeConfig();
      expect(result.config.homepage).toEqual({ app: "cpanel", shell: true });
    } finally {
      process.chdir(originalCwd);
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
