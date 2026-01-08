import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { DatabaseAdapter, DatabaseService } from "@buntime/plugin-database";
import type { PluginContext, PluginLogger } from "@buntime/shared/types";
import keyvalExtension, { keyvalExtension as namedExport } from "./plugin";
import { initSchema } from "./server/lib/schema";
import { createTestAdapter } from "./server/lib/test-helpers";

describe("plugin-keyval", () => {
  describe("default export", () => {
    it("should export a function", () => {
      expect(typeof keyvalExtension).toBe("function");
    });

    it("should return a plugin object when called", () => {
      const plugin = keyvalExtension();
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("object");
    });

    it("should have correct plugin name", () => {
      const plugin = keyvalExtension();
      expect(plugin.name).toBe("@buntime/plugin-keyval");
    });

    it("should have default base path /keyval", () => {
      const plugin = keyvalExtension();
      expect(plugin.base).toBe("/keyval");
    });

    it("should accept custom base path", () => {
      const plugin = keyvalExtension({ base: "/custom-kv" });
      expect(plugin.base).toBe("/custom-kv");
    });

    it("should declare plugin-database as dependency", () => {
      const plugin = keyvalExtension();
      expect(plugin.dependencies).toContain("@buntime/plugin-database");
    });

    it("should have routes defined", () => {
      const plugin = keyvalExtension();
      expect(plugin.routes).toBeDefined();
    });

    it("should have fragment with patch type", () => {
      const plugin = keyvalExtension();
      expect(plugin.fragment).toEqual({ type: "patch" });
    });

    it("should have menu configuration", () => {
      const plugin = keyvalExtension();
      expect(plugin.menus).toBeDefined();
      expect(Array.isArray(plugin.menus)).toBe(true);
      expect(plugin.menus?.length).toBeGreaterThan(0);
    });

    it("should have main menu with correct structure", () => {
      const plugin = keyvalExtension();
      const mainMenu = plugin.menus?.[0];

      expect(mainMenu).toBeDefined();
      expect(mainMenu?.icon).toBe("lucide:database");
      expect(mainMenu?.path).toBe("/keyval");
      expect(mainMenu?.title).toBe("KeyVal");
      expect(mainMenu?.priority).toBe(80);
    });

    it("should have submenu items", () => {
      const plugin = keyvalExtension();
      const mainMenu = plugin.menus?.[0];
      const items = mainMenu?.items;

      expect(items).toBeDefined();
      expect(Array.isArray(items)).toBe(true);
      expect(items?.length).toBeGreaterThan(0);
    });

    it("should have expected submenu paths", () => {
      const plugin = keyvalExtension();
      const items = plugin.menus?.[0]?.items ?? [];
      const paths = items.map((item) => item.path);

      expect(paths).toContain("/keyval");
      expect(paths).toContain("/keyval/entries");
      expect(paths).toContain("/keyval/queue");
      expect(paths).toContain("/keyval/search");
      expect(paths).toContain("/keyval/watch");
      expect(paths).toContain("/keyval/atomic");
      expect(paths).toContain("/keyval/metrics");
    });

    it("should have onInit lifecycle hook", () => {
      const plugin = keyvalExtension();
      expect(plugin.onInit).toBeDefined();
      expect(typeof plugin.onInit).toBe("function");
    });

    it("should have onShutdown lifecycle hook", () => {
      const plugin = keyvalExtension();
      expect(plugin.onShutdown).toBeDefined();
      expect(typeof plugin.onShutdown).toBe("function");
    });
  });

  describe("named export", () => {
    it("should be the same as default export", () => {
      expect(namedExport).toBe(keyvalExtension);
    });
  });

  describe("config options", () => {
    it("should accept database adapter type", () => {
      const plugin = keyvalExtension({ database: "libsql" });
      expect(plugin).toBeDefined();
    });

    it("should accept metrics configuration", () => {
      const plugin = keyvalExtension({
        metrics: {
          persistent: true,
          flushInterval: 60000,
        },
      });
      expect(plugin).toBeDefined();
    });

    it("should accept queue configuration", () => {
      const plugin = keyvalExtension({
        queue: {
          cleanupInterval: 30000,
          lockDuration: 15000,
        },
      });
      expect(plugin).toBeDefined();
    });

    it("should accept all options combined", () => {
      const plugin = keyvalExtension({
        base: "/kv",
        database: "libsql",
        metrics: {
          persistent: true,
          flushInterval: 60000,
        },
        queue: {
          cleanupInterval: 30000,
          lockDuration: 15000,
        },
      });
      expect(plugin.base).toBe("/kv");
    });

    it("should work with empty config", () => {
      const plugin = keyvalExtension({});
      expect(plugin.name).toBe("@buntime/plugin-keyval");
      expect(plugin.base).toBe("/keyval");
    });
  });

  describe("type exports", () => {
    it("should export Kv class", async () => {
      const { Kv } = await import("./plugin");
      expect(Kv).toBeDefined();
      expect(typeof Kv).toBe("function");
    });

    it("should export AtomicOperation class", async () => {
      const { AtomicOperation } = await import("./plugin");
      expect(AtomicOperation).toBeDefined();
      expect(typeof AtomicOperation).toBe("function");
    });

    it("should export KvFts class", async () => {
      const { KvFts } = await import("./plugin");
      expect(KvFts).toBeDefined();
      expect(typeof KvFts).toBe("function");
    });

    it("should export KvMetrics class", async () => {
      const { KvMetrics } = await import("./plugin");
      expect(KvMetrics).toBeDefined();
      expect(typeof KvMetrics).toBe("function");
    });

    it("should export KvQueue class", async () => {
      const { KvQueue } = await import("./plugin");
      expect(KvQueue).toBeDefined();
      expect(typeof KvQueue).toBe("function");
    });

    it("should export KvTransaction class", async () => {
      const { KvTransaction } = await import("./plugin");
      expect(KvTransaction).toBeDefined();
      expect(typeof KvTransaction).toBe("function");
    });

    it("should export initSchema function", async () => {
      const { initSchema } = await import("./plugin");
      expect(initSchema).toBeDefined();
      expect(typeof initSchema).toBe("function");
    });

    it("should export createUuidv7 function", async () => {
      const { createUuidv7 } = await import("./plugin");
      expect(createUuidv7).toBeDefined();
      expect(typeof createUuidv7).toBe("function");
    });

    it("should export UUIDV7_SYMBOL", async () => {
      const { UUIDV7_SYMBOL } = await import("./plugin");
      expect(UUIDV7_SYMBOL).toBeDefined();
      expect(typeof UUIDV7_SYMBOL).toBe("symbol");
    });
  });

  describe("createUuidv7", () => {
    it("should create a uuidv7 placeholder object", async () => {
      const { createUuidv7, UUIDV7_SYMBOL } = await import("./plugin");
      const placeholder = createUuidv7();

      expect(placeholder).toBeDefined();
      expect(placeholder[UUIDV7_SYMBOL]).toBe(true);
    });

    it("should create unique instances", async () => {
      const { createUuidv7 } = await import("./plugin");
      const p1 = createUuidv7();
      const p2 = createUuidv7();

      // They are different object instances but structurally equal
      expect(p1).not.toBe(p2);
    });
  });

  describe("lifecycle hooks", () => {
    let adapter: DatabaseAdapter;
    let mockLogger: PluginLogger;
    let mockDatabaseService: DatabaseService;
    let registeredServices: Map<string, unknown>;

    beforeAll(async () => {
      adapter = createTestAdapter();
      await initSchema(adapter);

      mockLogger = {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: () => {},
      };

      mockDatabaseService = {
        getAdapter: () => adapter,
        getDefaultType: () => "libsql",
        getRootAdapter: () => adapter,
        hasAdapter: () => true,
        listAdapterTypes: () => ["libsql"],
      };

      registeredServices = new Map();
    });

    afterAll(async () => {
      await adapter.close();
    });

    it("should initialize successfully with valid context", async () => {
      const plugin = keyvalExtension();

      const mockContext: PluginContext = {
        config: {},
        getService: <T>(name: string): T | undefined => {
          if (name === "database") {
            return mockDatabaseService as T;
          }
          return undefined;
        },
        logger: mockLogger,
        registerService: (name: string, service: unknown) => {
          registeredServices.set(name, service);
        },
      };

      await plugin.onInit?.(mockContext);

      // Verify kv service was registered
      expect(registeredServices.has("kv")).toBe(true);
      expect(registeredServices.get("kv")).toBeDefined();

      // Cleanup
      await plugin.onShutdown?.();
    });

    it("should throw error when database service is not available", async () => {
      const plugin = keyvalExtension();

      const mockContext: PluginContext = {
        config: {},
        getService: <T>(_name: string): T | undefined => {
          return undefined;
        },
        logger: mockLogger,
        registerService: () => {},
      };

      await expect(plugin.onInit?.(mockContext)).rejects.toThrow(
        "plugin-keyval requires plugin-database to be loaded first",
      );
    });

    it("should initialize with custom database adapter type", async () => {
      const plugin = keyvalExtension({ database: "libsql" });

      const mockContext: PluginContext = {
        config: {},
        getService: <T>(name: string): T | undefined => {
          if (name === "database") {
            return mockDatabaseService as T;
          }
          return undefined;
        },
        logger: mockLogger,
        registerService: (name: string, service: unknown) => {
          registeredServices.set(name, service);
        },
      };

      await plugin.onInit?.(mockContext);
      expect(registeredServices.has("kv")).toBe(true);

      await plugin.onShutdown?.();
    });

    it("should initialize with metrics and queue configuration", async () => {
      const plugin = keyvalExtension({
        metrics: {
          persistent: true,
          flushInterval: 60000,
        },
        queue: {
          cleanupInterval: 30000,
          lockDuration: 15000,
        },
      });

      const mockContext: PluginContext = {
        config: {},
        getService: <T>(name: string): T | undefined => {
          if (name === "database") {
            return mockDatabaseService as T;
          }
          return undefined;
        },
        logger: mockLogger,
        registerService: (name: string, service: unknown) => {
          registeredServices.set(name, service);
        },
      };

      await plugin.onInit?.(mockContext);
      expect(registeredServices.has("kv")).toBe(true);

      await plugin.onShutdown?.();
    });

    it("should log info message on successful initialization", async () => {
      const plugin = keyvalExtension();
      const infoLogs: string[] = [];

      const loggingLogger: PluginLogger = {
        debug: () => {},
        error: () => {},
        info: (msg: string) => infoLogs.push(msg),
        warn: () => {},
      };

      const mockContext: PluginContext = {
        config: {},
        getService: <T>(name: string): T | undefined => {
          if (name === "database") {
            return mockDatabaseService as T;
          }
          return undefined;
        },
        logger: loggingLogger,
        registerService: () => {},
      };

      await plugin.onInit?.(mockContext);

      expect(infoLogs.some((msg) => msg.includes("KeyVal initialized"))).toBe(true);

      await plugin.onShutdown?.();
    });

    it("should shutdown gracefully", async () => {
      const plugin = keyvalExtension();

      const mockContext: PluginContext = {
        config: {},
        getService: <T>(name: string): T | undefined => {
          if (name === "database") {
            return mockDatabaseService as T;
          }
          return undefined;
        },
        logger: mockLogger,
        registerService: () => {},
      };

      await plugin.onInit?.(mockContext);

      // Shutdown should not throw
      await expect(plugin.onShutdown?.()).resolves.toBeUndefined();
    });

    it("should handle shutdown when not initialized", async () => {
      const plugin = keyvalExtension();

      // Calling shutdown without init should not throw
      await expect(plugin.onShutdown?.()).resolves.toBeUndefined();
    });
  });
});
