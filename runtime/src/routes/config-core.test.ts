import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as runtimeConfig from "@/config";
import * as database from "@/libs/database";
import type { PluginLoader } from "@/plugins/loader";
import { createConfigCoreRoutes } from "./config-core";

describe("createConfigCoreRoutes", () => {
  const testDir = join(import.meta.dirname, "__test-config-core__");

  // Mock loader
  const createMockLoader = (
    versions: Record<string, string[]> = {},
  ): PluginLoader & { setActiveVersionMock: ReturnType<typeof mock> } => {
    const setActiveVersionMock = mock(() => {});
    return {
      getVersions: (name: string) => versions[name] ?? [],
      getActiveVersion: (name: string) => database.getPluginVersion(name),
      setActiveVersion: setActiveVersionMock,
      load: mock(() => Promise.resolve({} as never)),
      loadPlugin: mock(() => Promise.resolve({} as never)),
      list: mock(() => []),
      rescan: mock(() => Promise.resolve({} as never)),
      setActiveVersionMock,
    } as unknown as PluginLoader & { setActiveVersionMock: ReturnType<typeof mock> };
  };

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });

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
  });

  afterAll(() => {
    database.closeDatabase();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Clear database between tests
    const db = database.getDatabase();
    db.run("DELETE FROM plugins");
  });

  describe("GET /plugins", () => {
    it("should return empty data when no plugins configured", async () => {
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request("http://localhost/plugins");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ configs: {}, versions: [] });
    });

    it("should return versions and configs", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      database.setPluginConfig("@buntime/plugin-keyval", "key1", "value1");

      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request("http://localhost/plugins");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        configs: Record<string, Record<string, unknown>>;
        versions: Array<{ name: string; version: string }>;
      };

      expect(json.versions).toHaveLength(1);
      expect(json.versions[0]?.name).toBe("@buntime/plugin-keyval");
      expect(json.versions[0]?.version).toBe("1.0.0");
      expect(json.configs["@buntime/plugin-keyval"]).toEqual({ key1: "value1" });
    });
  });

  describe("GET /plugins/:name/version", () => {
    it("should return latest for unknown plugin", async () => {
      const loader = createMockLoader({ "unknown-plugin": ["1.0.0", "0.9.0"] });
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request("http://localhost/plugins/unknown-plugin/version");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        activeVersion: string;
        availableVersions: string[];
        name: string;
      };
      expect(json.name).toBe("unknown-plugin");
      expect(json.activeVersion).toBe("latest");
      expect(json.availableVersions).toEqual(["1.0.0", "0.9.0"]);
    });

    it("should return configured version", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      const loader = createMockLoader({ "@buntime/plugin-keyval": ["1.0.0", "0.9.0"] });
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/version`,
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { activeVersion: string };
      expect(json.activeVersion).toBe("1.0.0");
    });
  });

  describe("PUT /plugins/:name/version", () => {
    it("should set version", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      const loader = createMockLoader({ "@buntime/plugin-keyval": ["1.0.0", "0.9.0"] });
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/version`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: "0.9.0" }),
        },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { success: boolean; activeVersion: string };
      expect(json.success).toBe(true);
      expect(json.activeVersion).toBe("0.9.0");
      expect(loader.setActiveVersionMock).toHaveBeenCalledWith("@buntime/plugin-keyval", "0.9.0");
    });

    it("should reject invalid version", async () => {
      const loader = createMockLoader({ "@buntime/plugin-keyval": ["1.0.0"] });
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/version`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: "9.9.9" }),
        },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(400);
    });

    it("should accept 'latest' as version", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      const loader = createMockLoader({ "@buntime/plugin-keyval": ["1.0.0"] });
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/version`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: "latest" }),
        },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { activeVersion: string };
      expect(json.activeVersion).toBe("latest");
    });

    it("should return 404 for unknown plugin", async () => {
      const loader = createMockLoader({});
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request("http://localhost/plugins/unknown/version", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: "1.0.0" }),
      });
      const res = await routes.fetch(req);

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /plugins/:name/version", () => {
    it("should reset to latest", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.setPluginVersion("@buntime/plugin-keyval", "1.0.0");
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/version`,
        { method: "DELETE" },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { activeVersion: string };
      expect(json.activeVersion).toBe("latest");
      expect(loader.setActiveVersionMock).toHaveBeenCalledWith("@buntime/plugin-keyval", "latest");
    });
  });

  describe("GET /plugins/:name/config", () => {
    it("should return empty config for unknown plugin", async () => {
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request("http://localhost/plugins/unknown/config");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { config: Record<string, unknown> };
      expect(json.config).toEqual({});
    });

    it("should return plugin config", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.setPluginConfig("@buntime/plugin-keyval", "key1", "value1");
      database.setPluginConfig("@buntime/plugin-keyval", "key2", "value2");
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/config`,
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { config: Record<string, unknown>; plugin: string };
      expect(json.plugin).toBe("@buntime/plugin-keyval");
      expect(json.config).toEqual({ key1: "value1", key2: "value2" });
    });
  });

  describe("PUT /plugins/:name/config/:key", () => {
    it("should set config value", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        "http://localhost/plugins/" +
          encodeURIComponent("@buntime/plugin-keyval") +
          "/config/metrics.interval",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: "60000" }),
        },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { success: boolean };
      expect(json.success).toBe(true);

      const stored = database.getPluginConfigValue("@buntime/plugin-keyval", "metrics.interval");
      expect(stored).toBe("60000");
    });

    it("should store object values", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        "http://localhost/plugins/" +
          encodeURIComponent("@buntime/plugin-keyval") +
          "/config/nested",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: { a: 1, b: 2 } }),
        },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);

      const stored = database.getPluginConfigValue("@buntime/plugin-keyval", "nested");
      expect(stored).toEqual({ a: 1, b: 2 });
    });
  });

  describe("DELETE /plugins/:name/config/:key", () => {
    it("should delete config key", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.setPluginConfig("@buntime/plugin-keyval", "key1", "value1");
      database.setPluginConfig("@buntime/plugin-keyval", "key2", "value2");
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/config/key1`,
        { method: "DELETE" },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);

      const config = database.getPluginConfig("@buntime/plugin-keyval");
      expect(config.key1).toBeUndefined();
      expect(config.key2).toBe("value2");
    });
  });

  describe("DELETE /plugins/:name/config", () => {
    it("should delete all config for plugin", async () => {
      database.seedPluginFromManifest({ name: "@buntime/plugin-keyval", base: "/keyval" });
      database.setPluginConfig("@buntime/plugin-keyval", "key1", "value1");
      database.setPluginConfig("@buntime/plugin-keyval", "key2", "value2");
      const loader = createMockLoader();
      const routes = createConfigCoreRoutes({ loader });

      const req = new Request(
        `http://localhost/plugins/${encodeURIComponent("@buntime/plugin-keyval")}/config`,
        { method: "DELETE" },
      );
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);

      const config = database.getPluginConfig("@buntime/plugin-keyval");
      expect(config).toEqual({});
    });
  });
});
