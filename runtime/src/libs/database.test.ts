import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as runtimeConfig from "@/config";

// Re-import after mocking to get fresh module state
let database: typeof import("./database");

describe("database", () => {
  const testDir = join(import.meta.dirname, "__test-database__");
  const dbPath = join(testDir, "buntime.db");

  beforeAll(() => {
    // Create test directory
    mkdirSync(testDir, { recursive: true });

    // Mock getConfig to use test directory
    spyOn(runtimeConfig, "getConfig").mockReturnValue({
      bodySize: { default: 10 * 1024 * 1024, max: 100 * 1024 * 1024 },
      configDir: testDir,
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

    // Import database module after mocking
    database = require("./database");
  });

  afterAll(() => {
    // Close database and clean up
    database.closeDatabase();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Clear data between tests
    const db = database.getDatabase();
    db.run("DELETE FROM plugins");
  });

  describe("getDatabase", () => {
    it("should create database file", () => {
      database.getDatabase();
      expect(existsSync(dbPath)).toBe(true);
    });

    it("should return same instance on multiple calls", () => {
      const db1 = database.getDatabase();
      const db2 = database.getDatabase();
      expect(db1).toBe(db2);
    });
  });

  describe("seedPluginFromManifest", () => {
    it("should seed new plugin with manifest data", () => {
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        dependencies: ["@buntime/plugin-database"],
        fragment: { type: "patch" },
        menus: [{ icon: "lucide:database", path: "/keyval", title: "KeyVal" }],
      });

      const plugin = database.getPlugin("@buntime/plugin-keyval");
      expect(plugin).toBeDefined();
      expect(plugin?.base).toBe("/keyval");
      expect(plugin?.dependencies).toEqual(["@buntime/plugin-database"]);
      expect(plugin?.fragment).toEqual({ type: "patch" });
      expect(plugin?.menus).toHaveLength(1);
      expect(plugin?.enabled).toBe(true); // Default enabled
    });

    it("should seed plugin with enabled=false from manifest", () => {
      database.seedPluginFromManifest({
        name: "@buntime/plugin-disabled",
        base: "/disabled",
        enabled: false,
      });

      const plugin = database.getPlugin("@buntime/plugin-disabled");
      expect(plugin?.enabled).toBe(false);
    });

    it("should skip re-seed if plugin already exists (database is source of truth)", () => {
      // First seed
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
      });

      // Disable it via API
      database.disablePlugin("@buntime/plugin-keyval");

      // Re-seed with different values (simulating redeploy)
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval-v2", // Different base
        enabled: true, // Different enabled
      });

      // Database values should be preserved (not overwritten by manifest)
      const plugin = database.getPlugin("@buntime/plugin-keyval");
      expect(plugin?.base).toBe("/keyval"); // Original value preserved
      expect(plugin?.enabled).toBe(false); // API change preserved
    });

    it("should not update config on re-seed", () => {
      // First seed with config
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        database: "libsql",
        metrics: { flushInterval: 30000 },
      });

      // Override config via API
      database.setPluginConfig("@buntime/plugin-keyval", "database", "sqlite");

      // Re-seed with different manifest config
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        database: "postgres", // Different value in manifest
        metrics: { flushInterval: 60000 }, // Different value in manifest
        newField: "newValue", // New field in manifest
      });

      const config = database.getPluginConfig("@buntime/plugin-keyval");
      // Database is source of truth - manifest changes are ignored on re-seed
      expect(config.database).toBe("sqlite"); // API override preserved
      expect(config.metrics).toEqual({ flushInterval: 30000 }); // Original seed value
      expect(config.newField).toBeUndefined(); // New field NOT added
    });

    it("should extract plugin-specific config from manifest", () => {
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        // These are known manifest fields (not config)
        dependencies: ["@buntime/plugin-database"],
        fragment: { type: "patch" },
        // These are plugin-specific config
        database: "libsql",
        customSetting: true,
      });

      const plugin = database.getPlugin("@buntime/plugin-keyval");
      expect(plugin?.config).toEqual({
        database: "libsql",
        customSetting: true,
      });
    });
  });

  describe("plugin enabled/disabled", () => {
    beforeEach(() => {
      // Seed plugins before testing enable/disable
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.seedPluginFromManifest({ name: "@buntime/plugin-database", base: "/database" });
      database.seedPluginFromManifest({ name: "@buntime/plugin-disabled", base: "/disabled" });
    });

    it("should return false for unknown plugin", () => {
      const enabled = database.isPluginEnabled("unknown-plugin");
      expect(enabled).toBe(false);
    });

    it("should enable and check plugin", () => {
      // Plugin was seeded with enabled=true by default
      const enabled = database.isPluginEnabled("@buntime/plugin-keyval");
      expect(enabled).toBe(true);
    });

    it("should disable plugin", () => {
      database.disablePlugin("@buntime/plugin-keyval");
      const enabled = database.isPluginEnabled("@buntime/plugin-keyval");
      expect(enabled).toBe(false);
    });

    it("should get all enabled plugins", () => {
      database.disablePlugin("@buntime/plugin-disabled");

      const enabled = database.getEnabledPlugins();
      expect(enabled).toContain("@buntime/plugin-keyval");
      expect(enabled).toContain("@buntime/plugin-database");
      expect(enabled).not.toContain("@buntime/plugin-disabled");
    });

    it("should throw when enabling non-existent plugin", () => {
      expect(() => database.enablePlugin("unknown-plugin")).toThrow(
        'Plugin "unknown-plugin" not found in database',
      );
    });
  });

  describe("plugin versions", () => {
    beforeEach(() => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
    });

    it("should return 'latest' for unknown plugin", () => {
      const version = database.getPluginVersion("unknown-plugin");
      expect(version).toBe("latest");
    });

    it("should set and get plugin version", () => {
      database.setPluginVersion("@buntime/plugin-keyval", "1.2.0");
      const version = database.getPluginVersion("@buntime/plugin-keyval");
      expect(version).toBe("1.2.0");
    });

    it("should update existing plugin version", () => {
      database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      database.setPluginVersion("@buntime/plugin-keyval", "2.0.0");
      const version = database.getPluginVersion("@buntime/plugin-keyval");
      expect(version).toBe("2.0.0");
    });

    it("should reset plugin version to latest", () => {
      database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      database.resetPluginVersion("@buntime/plugin-keyval");
      const version = database.getPluginVersion("@buntime/plugin-keyval");
      expect(version).toBe("latest");
    });

    it("should throw when setting version for non-existent plugin", () => {
      expect(() => database.setPluginVersion("unknown-plugin", "1.0.0")).toThrow(
        'Plugin "unknown-plugin" not found in database',
      );
    });
  });

  describe("plugin config", () => {
    const pluginName = "@buntime/plugin-keyval";

    beforeEach(() => {
      database.seedPluginFromManifest({ name: pluginName, base: "/keyval" });
    });

    it("should return empty object for plugin with no config", () => {
      const config = database.getPluginConfig(pluginName);
      expect(config).toEqual({});
    });

    it("should set and get config value", () => {
      database.setPluginConfig(pluginName, "metrics.flushInterval", 60000);
      const config = database.getPluginConfig(pluginName);
      expect(config["metrics.flushInterval"]).toBe(60000);
    });

    it("should get single config value", () => {
      database.setPluginConfig(pluginName, "metrics.flushInterval", 60000);
      const value = database.getPluginConfigValue(pluginName, "metrics.flushInterval");
      expect(value).toBe(60000);
    });

    it("should return undefined for unknown config key", () => {
      const value = database.getPluginConfigValue(pluginName, "unknown.key");
      expect(value).toBe(undefined);
    });

    it("should update existing config value", () => {
      database.setPluginConfig(pluginName, "key", "value1");
      database.setPluginConfig(pluginName, "key", "value2");
      const value = database.getPluginConfigValue(pluginName, "key");
      expect(value).toBe("value2");
    });

    it("should delete single config key", () => {
      database.setPluginConfig(pluginName, "key1", "value1");
      database.setPluginConfig(pluginName, "key2", "value2");

      database.deletePluginConfig(pluginName, "key1");

      const config = database.getPluginConfig(pluginName);
      expect(config.key1).toBeUndefined();
      expect(config.key2).toBe("value2");
    });

    it("should delete all config for a plugin", () => {
      database.setPluginConfig(pluginName, "key1", "value1");
      database.setPluginConfig(pluginName, "key2", "value2");

      database.deletePluginConfig(pluginName);

      const config = database.getPluginConfig(pluginName);
      expect(config).toEqual({});
    });

    it("should handle multiple plugins", () => {
      const plugin1 = "@buntime/plugin-keyval";
      const plugin2 = "@buntime/plugin-database";

      database.seedPluginFromManifest({ name: plugin2, base: "/database" });

      database.setPluginConfig(plugin1, "key", "value1");
      database.setPluginConfig(plugin2, "key", "value2");

      expect(database.getPluginConfigValue(plugin1, "key")).toBe("value1");
      expect(database.getPluginConfigValue(plugin2, "key")).toBe("value2");
    });

    it("should store complex values as JSON", () => {
      const complexValue = { nested: { value: 123 }, array: [1, 2, 3] };
      database.setPluginConfig(pluginName, "complex", complexValue);

      const value = database.getPluginConfigValue(pluginName, "complex");
      expect(value).toEqual(complexValue);
    });

    it("should replace all config with setPluginConfigAll", () => {
      database.setPluginConfig(pluginName, "key1", "value1");
      database.setPluginConfig(pluginName, "key2", "value2");

      database.setPluginConfigAll(pluginName, { newKey: "newValue" });

      const config = database.getPluginConfig(pluginName);
      expect(config).toEqual({ newKey: "newValue" });
    });

    it("should throw when setting config for non-existent plugin", () => {
      expect(() => database.setPluginConfig("unknown-plugin", "key", "value")).toThrow(
        'Plugin "unknown-plugin" not found in database',
      );
    });
  });

  describe("getAllPlugins", () => {
    it("should return empty array when no plugins", () => {
      const plugins = database.getAllPlugins();
      expect(plugins).toEqual([]);
    });

    it("should return all plugins with full state", () => {
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        dependencies: ["@buntime/plugin-database"],
      });
      database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      database.setPluginConfig("@buntime/plugin-keyval", "key", "value");

      database.seedPluginFromManifest({ name: "@buntime/plugin-database", base: "/database" });
      database.disablePlugin("@buntime/plugin-database");

      const plugins = database.getAllPlugins();

      expect(plugins.length).toBe(2);

      const keyval = plugins.find((p) => p.name === "@buntime/plugin-keyval");
      expect(keyval).toBeDefined();
      expect(keyval?.enabled).toBe(true);
      expect(keyval?.version).toBe("1.0.0");
      expect(keyval?.config).toEqual({ key: "value" });
      expect(keyval?.base).toBe("/keyval");
      expect(keyval?.dependencies).toEqual(["@buntime/plugin-database"]);

      const db = plugins.find((p) => p.name === "@buntime/plugin-database");
      expect(db).toBeDefined();
      expect(db?.enabled).toBe(false);
      expect(db?.base).toBe("/database");
    });
  });

  describe("getPlugin", () => {
    it("should return null for unknown plugin", () => {
      const plugin = database.getPlugin("unknown-plugin");
      expect(plugin).toBeNull();
    });

    it("should return plugin with all fields", () => {
      database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        dependencies: ["@buntime/plugin-database"],
        fragment: { type: "patch" },
        menus: [{ icon: "lucide:database", path: "/keyval", title: "KeyVal" }],
        database: "libsql",
      });

      const plugin = database.getPlugin("@buntime/plugin-keyval");

      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe("@buntime/plugin-keyval");
      expect(plugin?.base).toBe("/keyval");
      expect(plugin?.enabled).toBe(true);
      expect(plugin?.dependencies).toEqual(["@buntime/plugin-database"]);
      expect(plugin?.fragment).toEqual({ type: "patch" });
      expect(plugin?.menus).toHaveLength(1);
      expect(plugin?.config).toEqual({ database: "libsql" });
      expect(plugin?.createdAt).toBeDefined();
      expect(plugin?.updatedAt).toBeDefined();
    });
  });

  describe("removePluginFromDb", () => {
    it("should remove plugin completely", () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      database.setPluginConfig("@buntime/plugin-keyval", "key", "value");

      database.removePluginFromDb("@buntime/plugin-keyval");

      expect(database.isPluginEnabled("@buntime/plugin-keyval")).toBe(false);
      expect(database.getPluginVersion("@buntime/plugin-keyval")).toBe("latest");
      expect(database.getPluginConfig("@buntime/plugin-keyval")).toEqual({});
      expect(database.getPlugin("@buntime/plugin-keyval")).toBeNull();
    });
  });

  describe("closeDatabase", () => {
    it("should close without error", () => {
      expect(() => database.closeDatabase()).not.toThrow();
    });

    it("should allow reopening after close", () => {
      database.closeDatabase();
      const db = database.getDatabase();
      expect(db).toBeDefined();
    });
  });
});
