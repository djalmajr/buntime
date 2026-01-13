import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as runtimeConfig from "@/config";

// Re-import after mocking to get fresh module state
let database: typeof import("./database");

describe("database", () => {
  const testLibsqlUrl = "http://localhost:8880";

  beforeAll(async () => {
    // Mock getConfig to use test libSQL server
    spyOn(runtimeConfig, "getConfig").mockReturnValue({
      bodySize: { default: 10 * 1024 * 1024, max: 100 * 1024 * 1024 },
      delayMs: 100,
      isCompiled: false,
      isDev: true,
      libsqlUrl: testLibsqlUrl,
      nodeEnv: "test",
      pluginDirs: ["./plugins"],
      poolSize: 10,
      port: 8000,
      version: "1.0.0",
      workerDirs: ["/tmp"],
    });

    // Import database module after mocking
    database = require("./database");

    // Initialize database
    await database.initDatabase();
  });

  beforeEach(async () => {
    // Clear data between tests
    await database.execute("DELETE FROM plugins");
  });

  afterAll(async () => {
    // Clean up
    await database.execute("DELETE FROM plugins");
  });

  describe("initDatabase", () => {
    it("should initialize database client", async () => {
      const client = database.getClient();
      expect(client).toBeDefined();
    });
  });

  describe("seedPluginFromManifest", () => {
    it("should seed new plugin with manifest data", async () => {
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        dependencies: ["@buntime/plugin-database"],
        fragment: { type: "patch" },
        menus: [{ icon: "lucide:database", path: "/keyval", title: "KeyVal" }],
      });

      const plugin = await database.getPlugin("@buntime/plugin-keyval");
      expect(plugin).toBeDefined();
      expect(plugin?.base).toBe("/keyval");
      expect(plugin?.dependencies).toEqual(["@buntime/plugin-database"]);
      expect(plugin?.fragment).toEqual({ type: "patch" });
      expect(plugin?.menus).toHaveLength(1);
      expect(plugin?.enabled).toBe(true); // Default enabled
    });

    it("should seed plugin with enabled=false from manifest", async () => {
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-disabled",
        base: "/disabled",
        enabled: false,
      });

      const plugin = await database.getPlugin("@buntime/plugin-disabled");
      expect(plugin?.enabled).toBe(false);
    });

    it("should skip re-seed if plugin already exists (database is source of truth)", async () => {
      // First seed
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
      });

      // Disable it via API
      await database.disablePlugin("@buntime/plugin-keyval");

      // Re-seed with different values (simulating redeploy)
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval-v2", // Different base
        enabled: true, // Different enabled
      });

      // Database values should be preserved (not overwritten by manifest)
      const plugin = await database.getPlugin("@buntime/plugin-keyval");
      expect(plugin?.base).toBe("/keyval"); // Original value preserved
      expect(plugin?.enabled).toBe(false); // API change preserved
    });
  });

  describe("plugin enabled/disabled", () => {
    beforeEach(async () => {
      // Seed plugins before testing enable/disable
      await database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-database",
        base: "/database",
      });
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-disabled",
        base: "/disabled",
      });
    });

    it("should return false for unknown plugin", async () => {
      const enabled = await database.isPluginEnabled("unknown-plugin");
      expect(enabled).toBe(false);
    });

    it("should enable and check plugin", async () => {
      // Plugin was seeded with enabled=true by default
      const enabled = await database.isPluginEnabled("@buntime/plugin-keyval");
      expect(enabled).toBe(true);
    });

    it("should disable plugin", async () => {
      await database.disablePlugin("@buntime/plugin-keyval");
      const enabled = await database.isPluginEnabled("@buntime/plugin-keyval");
      expect(enabled).toBe(false);
    });

    it("should get all enabled plugins", async () => {
      await database.disablePlugin("@buntime/plugin-disabled");

      const enabled = await database.getEnabledPlugins();
      expect(enabled).toContain("@buntime/plugin-keyval");
      expect(enabled).toContain("@buntime/plugin-database");
      expect(enabled).not.toContain("@buntime/plugin-disabled");
    });
  });

  describe("plugin versions", () => {
    beforeEach(async () => {
      await database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
    });

    it("should return 'latest' for unknown plugin", async () => {
      const version = await database.getPluginVersion("unknown-plugin");
      expect(version).toBe("latest");
    });

    it("should set and get plugin version", async () => {
      await database.setPluginVersion("@buntime/plugin-keyval", "1.2.0");
      const version = await database.getPluginVersion("@buntime/plugin-keyval");
      expect(version).toBe("1.2.0");
    });

    it("should update existing plugin version", async () => {
      await database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      await database.setPluginVersion("@buntime/plugin-keyval", "2.0.0");
      const version = await database.getPluginVersion("@buntime/plugin-keyval");
      expect(version).toBe("2.0.0");
    });

    it("should reset plugin version to latest", async () => {
      await database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      await database.resetPluginVersion("@buntime/plugin-keyval");
      const version = await database.getPluginVersion("@buntime/plugin-keyval");
      expect(version).toBe("latest");
    });
  });

  describe("plugin config", () => {
    const pluginName = "@buntime/plugin-keyval";

    beforeEach(async () => {
      await database.seedPluginFromManifest({ name: pluginName, base: "/keyval" });
    });

    it("should return empty object for plugin with no config", async () => {
      const config = await database.getPluginConfig(pluginName);
      expect(config).toEqual({});
    });

    it("should set and get config value", async () => {
      await database.setPluginConfig(pluginName, "metrics.flushInterval", 60000);
      const config = await database.getPluginConfig(pluginName);
      expect(config["metrics.flushInterval"]).toBe(60000);
    });

    it("should update existing config value", async () => {
      await database.setPluginConfig(pluginName, "key", "value1");
      await database.setPluginConfig(pluginName, "key", "value2");
      const config = await database.getPluginConfig(pluginName);
      expect(config.key).toBe("value2");
    });

    it("should delete single config key", async () => {
      await database.setPluginConfig(pluginName, "key1", "value1");
      await database.setPluginConfig(pluginName, "key2", "value2");

      await database.deletePluginConfig(pluginName, "key1");

      const config = await database.getPluginConfig(pluginName);
      expect(config.key1).toBeUndefined();
      expect(config.key2).toBe("value2");
    });

    it("should delete all config for a plugin", async () => {
      await database.setPluginConfig(pluginName, "key1", "value1");
      await database.setPluginConfig(pluginName, "key2", "value2");

      await database.deletePluginConfig(pluginName);

      const config = await database.getPluginConfig(pluginName);
      expect(config).toEqual({});
    });

    it("should store complex values as JSON", async () => {
      const complexValue = { nested: { value: 123 }, array: [1, 2, 3] };
      await database.setPluginConfig(pluginName, "complex", complexValue);

      const config = await database.getPluginConfig(pluginName);
      expect(config.complex).toEqual(complexValue);
    });
  });

  describe("getAllPlugins", () => {
    it("should return empty array when no plugins", async () => {
      const plugins = await database.getAllPlugins();
      expect(plugins).toEqual([]);
    });

    it("should return all plugins with full state", async () => {
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        dependencies: ["@buntime/plugin-database"],
      });
      await database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      await database.setPluginConfig("@buntime/plugin-keyval", "key", "value");

      await database.seedPluginFromManifest({
        name: "@buntime/plugin-database",
        base: "/database",
      });
      await database.disablePlugin("@buntime/plugin-database");

      const plugins = await database.getAllPlugins();

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
    it("should return null for unknown plugin", async () => {
      const plugin = await database.getPlugin("unknown-plugin");
      expect(plugin).toBeNull();
    });

    it("should return plugin with all fields", async () => {
      await database.seedPluginFromManifest({
        name: "@buntime/plugin-keyval",
        base: "/keyval",
        dependencies: ["@buntime/plugin-database"],
        fragment: { type: "patch" },
        menus: [{ icon: "lucide:database", path: "/keyval", title: "KeyVal" }],
        database: "libsql",
      });

      const plugin = await database.getPlugin("@buntime/plugin-keyval");

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
    it("should remove plugin completely", async () => {
      await database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      await database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      await database.setPluginConfig("@buntime/plugin-keyval", "key", "value");

      await database.removePluginFromDb("@buntime/plugin-keyval");

      expect(await database.isPluginEnabled("@buntime/plugin-keyval")).toBe(false);
      expect(await database.getPluginVersion("@buntime/plugin-keyval")).toBe("latest");
      expect(await database.getPluginConfig("@buntime/plugin-keyval")).toEqual({});
      expect(await database.getPlugin("@buntime/plugin-keyval")).toBeNull();
    });
  });
});
