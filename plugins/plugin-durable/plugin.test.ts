import { describe, expect, it, mock } from "bun:test";
import durableObjectsExtension, { durableObjectsExtension as namedExport } from "./plugin";

describe("durableObjectsExtension", () => {
  describe("plugin structure", () => {
    it("should export default and named export", () => {
      expect(durableObjectsExtension).toBeDefined();
      expect(namedExport).toBeDefined();
      expect(durableObjectsExtension).toBe(namedExport);
    });

    it("should return a valid PluginImpl with lifecycle hooks", () => {
      const plugin = durableObjectsExtension();

      // Plugin implementation has lifecycle hooks
      expect(plugin.onInit).toBeInstanceOf(Function);
      expect(plugin.onShutdown).toBeInstanceOf(Function);
    });
  });

  describe("configuration", () => {
    it("should accept empty config", () => {
      const plugin = durableObjectsExtension();

      expect(plugin).toBeDefined();
    });

    it("should accept all config options", () => {
      const config = {
        database: "libsql" as const,
        hibernateAfter: 120_000,
        maxObjects: 500,
      };

      const plugin = durableObjectsExtension(config);

      expect(plugin).toBeDefined();
      expect(plugin.onInit).toBeInstanceOf(Function);
    });
  });

  describe("onInit", () => {
    it("should throw when database service is not available", async () => {
      const plugin = durableObjectsExtension();

      const mockContext = {
        getService: mock(() => null),
        logger: {
          debug: mock(() => {}),
          error: mock(() => {}),
          info: mock(() => {}),
          warn: mock(() => {}),
        },
      };

      await expect(plugin.onInit!(mockContext as never)).rejects.toThrow(
        "@buntime/plugin-durable requires @buntime/plugin-database",
      );
    });

    it("should initialize with database service", async () => {
      const plugin = durableObjectsExtension({ database: "libsql" });

      const mockAdapter = {
        batch: mock(() => Promise.resolve([])),
        close: mock(() => Promise.resolve()),
        execute: mock(() => Promise.resolve([])),
        executeOne: mock(() => Promise.resolve(null)),
        type: "libsql",
      };

      const mockDatabaseService = {
        getDefaultType: mock(() => "libsql"),
        getRootAdapter: mock(() => mockAdapter),
      };

      const mockContext = {
        getService: mock((name: string) => {
          if (name === "database") return mockDatabaseService;
          return null;
        }),
        logger: {
          debug: mock(() => {}),
          error: mock(() => {}),
          info: mock(() => {}),
          warn: mock(() => {}),
        },
      };

      await plugin.onInit!(mockContext as never);

      expect(mockDatabaseService.getRootAdapter).toHaveBeenCalledWith("libsql");
      expect(mockContext.logger.info).toHaveBeenCalled();
    });

    it("should use default database type when not specified", async () => {
      const plugin = durableObjectsExtension();

      const mockAdapter = {
        batch: mock(() => Promise.resolve([])),
        close: mock(() => Promise.resolve()),
        execute: mock(() => Promise.resolve([])),
        executeOne: mock(() => Promise.resolve(null)),
        type: "libsql",
      };

      const mockDatabaseService = {
        getDefaultType: mock(() => "libsql"),
        getRootAdapter: mock(() => mockAdapter),
      };

      const mockContext = {
        getService: mock((name: string) => {
          if (name === "database") return mockDatabaseService;
          return null;
        }),
        logger: {
          debug: mock(() => {}),
          error: mock(() => {}),
          info: mock(() => {}),
          warn: mock(() => {}),
        },
      };

      await plugin.onInit!(mockContext as never);

      expect(mockDatabaseService.getRootAdapter).toHaveBeenCalledWith(undefined);
      expect(mockDatabaseService.getDefaultType).toHaveBeenCalled();
    });
  });

  describe("onShutdown", () => {
    it("should be defined and callable", async () => {
      const plugin = durableObjectsExtension();

      expect(plugin.onShutdown).toBeDefined();
      // onShutdown should not throw even if not initialized
      await expect(plugin.onShutdown!()).resolves.toBeUndefined();
    });
  });
});
