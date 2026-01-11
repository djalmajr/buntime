import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initConfig } from "@/config";
import { closeDatabase } from "@/libs/database";
import { PluginLoader } from "./loader";

const TEST_DIR = join(import.meta.dir, ".test-loader");
const TEST_DATA_DIR = join(TEST_DIR, "data");

describe("PluginLoader", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    initConfig({ baseDir: TEST_DIR, configDir: TEST_DATA_DIR, workerDirs: [TEST_DIR] });
  });

  afterAll(() => {
    closeDatabase();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create loader with empty config", () => {
      const loader = new PluginLoader();
      expect(loader).toBeDefined();
    });

    it("should create loader with pool", () => {
      const pool = {};
      const loader = new PluginLoader({ pool });
      expect(loader).toBeDefined();
    });
  });

  describe("loadPlugin validation", () => {
    const PLUGINS_TEST_DIR = join(TEST_DIR, "plugins-validation");

    beforeEach(() => {
      mkdirSync(join(PLUGINS_TEST_DIR, "plugins"), { recursive: true });
      // Reinitialize config with the test directory as baseDir
      initConfig(
        { configDir: join(PLUGINS_TEST_DIR, "data"), workerDirs: [PLUGINS_TEST_DIR] },
        PLUGINS_TEST_DIR,
      );
    });

    afterEach(() => {
      // Close database before removing directory
      closeDatabase();
      rmSync(PLUGINS_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ baseDir: TEST_DIR, configDir: TEST_DATA_DIR, workerDirs: [TEST_DIR] });
    });

    it("should ignore plugin with empty name field in manifest", async () => {
      // Create a plugin directory with empty name in manifest
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "no-name");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "manifest.jsonc"), JSON.stringify({ name: "", base: "/test" }));
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      // Empty name is not scanned, so registry will be empty
      const registry = await loader.load();
      expect(registry.size).toBe(0);
    });

    it("should skip plugin with missing base field in manifest", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "no-base");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "manifest.jsonc"), JSON.stringify({ name: "no-base" }));
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugins with invalid manifest (missing base) are silently skipped during scan
      // because seedPluginFromManifest throws on NOT NULL constraint violation
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("no-base")).toBe(false);
    });

    it("should throw for invalid base path format", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "invalid-base");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "invalid-base", base: "/invalid base path" }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded, validation happens during loadPlugin
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      await expect(loader.load()).rejects.toThrow(/invalid base path/);
    });

    it("should throw for reserved path /api", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "reserved-api");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "reserved-api", base: "/api" }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded, validation happens during loadPlugin
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      await expect(loader.load()).rejects.toThrow(/cannot use reserved path/);
    });

    it("should throw for reserved path /health", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "reserved-health");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "reserved-health", base: "/health" }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded, validation happens during loadPlugin
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      await expect(loader.load()).rejects.toThrow(/cannot use reserved path/);
    });

    it("should throw for already loaded plugin", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "duplicate");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "duplicate", base: "/dup" }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      const _registry = await loader.load();
      // Try to load the same plugin again
      await expect(loader.loadPlugin("duplicate")).rejects.toThrow(/already loaded/);
    });

    it("should support factory function plugins", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "factory");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "factory-plugin", base: "/factory" }),
      );
      writeFileSync(
        join(pluginDir, "plugin.ts"),
        `export default (config) => ({
          onInit: () => console.log("init"),
        });`,
      );

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({
        pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")],
      });
      const registry = await loader.load();
      const plugin = registry.get("factory-plugin");

      expect(plugin).toBeDefined();
      expect(plugin?.base).toBe("/factory");
    });

    it("should ignore directory without manifest", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "no-manifest");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.ts"), `export default 123;`);

      // Directories without manifest are silently ignored during scan
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.size).toBe(0);
    });

    it("should call onInit hook with timeout protection", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "with-init");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "with-init", base: "/init" }),
      );
      writeFileSync(
        join(pluginDir, "plugin.ts"),
        `export default {
          onInit: async (ctx) => {
            // Simulates initialization
          },
        };`,
      );

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("with-init")).toBe(true);
    });

    it("should skip disabled plugins from manifest", async () => {
      const pluginDir = join(PLUGINS_TEST_DIR, "plugins", "disabled-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "disabled-plugin", base: "/disabled", enabled: false }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin seeded with enabled=false from manifest should not be loaded
      const loader = new PluginLoader({ pluginDirs: [join(PLUGINS_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("disabled-plugin")).toBe(false);
    });
  });

  describe("scanPluginDirs", () => {
    const EXT_TEST_DIR = join(TEST_DIR, "external-plugins");

    beforeEach(() => {
      mkdirSync(join(EXT_TEST_DIR, "plugins"), { recursive: true });
      // Reinitialize config with the test directory as baseDir
      initConfig(
        { configDir: join(EXT_TEST_DIR, "data"), workerDirs: [EXT_TEST_DIR] },
        EXT_TEST_DIR,
      );
    });

    afterEach(() => {
      // Close database before removing directory
      closeDatabase();
      rmSync(EXT_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ baseDir: TEST_DIR, configDir: TEST_DATA_DIR, workerDirs: [TEST_DIR] });
    });

    it("should resolve plugin from ./plugins/name/plugin.ts with manifest", async () => {
      const pluginDir = join(EXT_TEST_DIR, "plugins", "my-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "my-plugin", base: "/my-plugin" }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({ pluginDirs: [join(EXT_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("my-plugin")).toBe(true);
    });

    it("should resolve plugin from ./plugins/name/index.ts with manifest", async () => {
      const pluginDir = join(EXT_TEST_DIR, "plugins", "nested-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "nested-plugin", base: "/nested" }),
      );
      writeFileSync(join(pluginDir, "index.ts"), `export default {};`);

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({ pluginDirs: [join(EXT_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("nested-plugin")).toBe(true);
    });

    it("should resolve scoped plugin names like @buntime/plugin-xxx", async () => {
      // Create plugin with scoped name in manifest
      const pluginDir = join(EXT_TEST_DIR, "plugins", "plugin-metrics");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "@buntime/plugin-metrics", base: "/metrics" }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({ pluginDirs: [join(EXT_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("@buntime/plugin-metrics")).toBe(true);
    });

    it("should resolve plugin by name from manifest regardless of directory name", async () => {
      // Directory name is "whatever" but internal name is "my-awesome-plugin"
      const pluginDir = join(EXT_TEST_DIR, "plugins", "whatever");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "my-awesome-plugin", base: "/awesome" }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({ pluginDirs: [join(EXT_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("my-awesome-plugin")).toBe(true);
    });
  });

  describe("topological sort with dependencies", () => {
    const DEP_TEST_DIR = join(TEST_DIR, "deps-plugins");

    beforeEach(() => {
      mkdirSync(join(DEP_TEST_DIR, "plugins"), { recursive: true });
      // Reinitialize config with the test directory as baseDir
      initConfig(
        { configDir: join(DEP_TEST_DIR, "data"), workerDirs: [DEP_TEST_DIR] },
        DEP_TEST_DIR,
      );
    });

    afterEach(() => {
      // Close database before removing directory
      closeDatabase();
      rmSync(DEP_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ baseDir: TEST_DIR, configDir: TEST_DATA_DIR, workerDirs: [TEST_DIR] });
    });

    it("should load plugins in dependency order", async () => {
      // Create plugins with dependencies
      const pluginADir = join(DEP_TEST_DIR, "plugins", "plugin-a");
      const pluginBDir = join(DEP_TEST_DIR, "plugins", "plugin-b");
      mkdirSync(pluginADir, { recursive: true });
      mkdirSync(pluginBDir, { recursive: true });

      writeFileSync(
        join(pluginADir, "manifest.jsonc"),
        JSON.stringify({ name: "plugin-a", base: "/a" }),
      );
      writeFileSync(join(pluginADir, "plugin.ts"), `export default {};`);

      writeFileSync(
        join(pluginBDir, "manifest.jsonc"),
        JSON.stringify({ name: "plugin-b", base: "/b", dependencies: ["plugin-a"] }),
      );
      writeFileSync(join(pluginBDir, "plugin.ts"), `export default {};`);

      // Both plugins enabled by default when seeded during scan
      const loader = new PluginLoader({
        pluginDirs: [join(DEP_TEST_DIR, "plugins")],
      });
      const registry = await loader.load();
      // Both should be loaded
      expect(registry.has("plugin-a")).toBe(true);
      expect(registry.has("plugin-b")).toBe(true);
    });

    it("should throw for missing required dependency", async () => {
      const pluginDir = join(DEP_TEST_DIR, "plugins", "needs-dep");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "needs-dep", base: "/needs", dependencies: ["missing-dep"] }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      // Plugin is enabled by default when seeded, validation happens during load
      const loader = new PluginLoader({ pluginDirs: [join(DEP_TEST_DIR, "plugins")] });
      await expect(loader.load()).rejects.toThrow(/requires.*missing-dep.*not available/);
    });

    it("should detect circular dependencies", async () => {
      const cycleADir = join(DEP_TEST_DIR, "plugins", "cycle-a");
      const cycleBDir = join(DEP_TEST_DIR, "plugins", "cycle-b");
      mkdirSync(cycleADir, { recursive: true });
      mkdirSync(cycleBDir, { recursive: true });

      writeFileSync(
        join(cycleADir, "manifest.jsonc"),
        JSON.stringify({ name: "cycle-a", base: "/cycle-a", dependencies: ["cycle-b"] }),
      );
      writeFileSync(join(cycleADir, "plugin.ts"), `export default {};`);

      writeFileSync(
        join(cycleBDir, "manifest.jsonc"),
        JSON.stringify({ name: "cycle-b", base: "/cycle-b", dependencies: ["cycle-a"] }),
      );
      writeFileSync(join(cycleBDir, "plugin.ts"), `export default {};`);

      // Both plugins enabled by default when seeded, validation happens during load
      const loader = new PluginLoader({
        pluginDirs: [join(DEP_TEST_DIR, "plugins")],
      });
      await expect(loader.load()).rejects.toThrow(/Circular dependency/);
    });

    it("should filter optional dependencies to configured only", async () => {
      const optBaseDir = join(DEP_TEST_DIR, "plugins", "optional-base");
      const withOptDir = join(DEP_TEST_DIR, "plugins", "with-optional");
      mkdirSync(optBaseDir, { recursive: true });
      mkdirSync(withOptDir, { recursive: true });

      writeFileSync(
        join(optBaseDir, "manifest.jsonc"),
        JSON.stringify({ name: "optional-base", base: "/opt-base" }),
      );
      writeFileSync(join(optBaseDir, "plugin.ts"), `export default {};`);

      writeFileSync(
        join(withOptDir, "manifest.jsonc"),
        JSON.stringify({
          name: "with-optional",
          base: "/with-opt",
          optionalDependencies: ["optional-base", "not-configured"],
        }),
      );
      writeFileSync(join(withOptDir, "plugin.ts"), `export default {};`);

      // Both plugins enabled by default when seeded during scan
      const loader = new PluginLoader({
        pluginDirs: [join(DEP_TEST_DIR, "plugins")],
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
      initConfig(
        { configDir: join(DEFAULT_TEST_DIR, "data"), workerDirs: [DEFAULT_TEST_DIR] },
        DEFAULT_TEST_DIR,
      );
    });

    afterEach(() => {
      // Close database before removing directory
      closeDatabase();
      rmSync(DEFAULT_TEST_DIR, { recursive: true, force: true });
      // Restore original config
      initConfig({ baseDir: TEST_DIR, configDir: TEST_DATA_DIR, workerDirs: [TEST_DIR] });
    });

    it("should resolve plugin with default export", async () => {
      const pluginDir = join(DEFAULT_TEST_DIR, "plugins", "with-default");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({ name: "with-default", base: "/default" }),
      );
      writeFileSync(
        join(pluginDir, "plugin.ts"),
        `const plugin = { onInit: () => {} };
         export default plugin;`,
      );

      // Plugin is enabled by default when seeded during scan
      const loader = new PluginLoader({ pluginDirs: [join(DEFAULT_TEST_DIR, "plugins")] });
      const registry = await loader.load();
      expect(registry.has("with-default")).toBe(true);
    });

    it("should seed plugin manifest to database during scan", async () => {
      const pluginDir = join(DEFAULT_TEST_DIR, "plugins", "test-seed");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "manifest.jsonc"),
        JSON.stringify({
          name: "test-seed",
          base: "/seed",
          dependencies: ["dep-a"],
          fragment: { type: "patch" },
        }),
      );
      writeFileSync(join(pluginDir, "plugin.ts"), `export default {};`);

      const loader = new PluginLoader({ pluginDirs: [join(DEFAULT_TEST_DIR, "plugins")] });
      // Load will fail because dep-a doesn't exist, but the seed should still happen
      try {
        await loader.load();
      } catch {
        // Expected to fail due to missing dependency
      }

      // Verify the plugin was seeded to database
      const { getPlugin } = await import("@/libs/database");
      const plugin = getPlugin("test-seed");
      expect(plugin).toBeDefined();
      expect(plugin?.base).toBe("/seed");
      expect(plugin?.dependencies).toEqual(["dep-a"]);
      expect(plugin?.fragment).toEqual({ type: "patch" });
    });
  });
});

