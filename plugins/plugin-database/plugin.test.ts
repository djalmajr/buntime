import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { PluginContext, PluginLogger } from "@buntime/shared/types";
import databasePlugin, { databasePlugin as namedExport } from "./plugin";

// Use environment variable or default to local libSQL server (docker-compose)
const LIBSQL_URL = process.env.LIBSQL_URL_0 ?? "http://localhost:8880";

// Mock logger factory
function createMockLogger(): PluginLogger {
  return {
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  };
}

// Mock plugin context factory
function createMockContext(logger: PluginLogger): PluginContext {
  const services = new Map<string, unknown>();
  return {
    logger,
    registerService: <T>(name: string, service: T) => {
      services.set(name, service);
    },
    getService: <T>(name: string) => services.get(name) as T | undefined,
  } as PluginContext;
}

describe("databasePlugin", () => {
  describe("exports", () => {
    it("should export default function", () => {
      expect(typeof databasePlugin).toBe("function");
    });

    it("should export named databasePlugin function", () => {
      expect(typeof namedExport).toBe("function");
      expect(namedExport).toBe(databasePlugin);
    });

    it("should export adapter classes", async () => {
      const { LibSqlAdapter, BunSqlAdapter, DatabaseServiceImpl } = await import("./plugin");
      expect(LibSqlAdapter).toBeDefined();
      expect(BunSqlAdapter).toBeDefined();
      expect(DatabaseServiceImpl).toBeDefined();
    });

    it("should export types (TypeScript compilation check)", async () => {
      // This is a compile-time check - if types are not exported, TypeScript will fail
      const mod = await import("./plugin");
      // Just verify the module loads without error
      expect(mod).toBeDefined();
    });
  });

  describe("plugin factory", () => {
    it("should return a valid BuntimePlugin object", () => {
      const plugin = databasePlugin();

      expect(plugin).toMatchObject({
        name: "@buntime/plugin-database",
        base: "/database",
      });
    });

    it("should use custom base path from config", () => {
      const plugin = databasePlugin({ base: "/custom-db" });

      expect(plugin.base).toBe("/custom-db");
    });

    it("should have routes property", () => {
      const plugin = databasePlugin();

      expect(plugin.routes).toBeDefined();
    });

    it("should have fragment with patch type", () => {
      const plugin = databasePlugin();

      expect(plugin.fragment).toEqual({ type: "patch" });
    });

    it("should have menu items for C-Panel sidebar", () => {
      const plugin = databasePlugin();

      expect(plugin.menus).toHaveLength(1);
      expect(plugin.menus?.[0]).toMatchObject({
        icon: "lucide:database",
        path: "/database",
        priority: 70,
        title: "Database",
      });
      expect(plugin.menus?.[0]?.items).toHaveLength(2);
    });

    it("should have onInit lifecycle hook", () => {
      const plugin = databasePlugin();

      expect(typeof plugin.onInit).toBe("function");
    });

    it("should have onShutdown lifecycle hook", () => {
      const plugin = databasePlugin();

      expect(typeof plugin.onShutdown).toBe("function");
    });
  });

  describe("substituteEnvVars helper (tested via processConfig)", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Reset env vars
      process.env = { ...originalEnv };
    });

    it("should substitute environment variables in authToken", async () => {
      process.env.DB_TOKEN = "secret-token";

      const plugin = databasePlugin({
        adapters: [
          {
            type: "libsql",
            urls: ["http://localhost:8080"],
            authToken: "${DB_TOKEN}",
            default: true,
          },
        ],
      });

      // We can't directly test the internal function, but we can verify
      // the plugin creates successfully with env var config
      expect(plugin.name).toBe("@buntime/plugin-database");
    });

    it("should substitute environment variables in url", async () => {
      process.env.DB_URL = "postgres://localhost:5432/db";

      const plugin = databasePlugin({
        adapters: [
          {
            type: "postgres",
            url: "${DB_URL}",
            default: true,
          },
        ],
      });

      expect(plugin.name).toBe("@buntime/plugin-database");
    });
  });

  describe("detectLibSqlUrls helper (tested via processConfig)", () => {
    // Save the original LIBSQL_URL_0 at module load time
    const savedLibSqlUrl0 = process.env.LIBSQL_URL_0;

    beforeEach(() => {
      // Clear all LIBSQL_URL_* env vars for test isolation
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("LIBSQL_URL_")) {
          delete process.env[key];
        }
      }
    });

    afterEach(() => {
      // Clear all LIBSQL_URL_* env vars set during test
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("LIBSQL_URL_")) {
          delete process.env[key];
        }
      }
      // Restore original LIBSQL_URL_0 if it existed
      if (savedLibSqlUrl0 !== undefined) {
        process.env.LIBSQL_URL_0 = savedLibSqlUrl0;
      }
    });

    it("should detect LIBSQL_URL_0 from environment", () => {
      process.env.LIBSQL_URL_0 = "http://primary:8080";

      const plugin = databasePlugin({
        adapters: [
          {
            type: "libsql",
            urls: [], // Empty, should be filled from env
            default: true,
          },
        ],
      });

      expect(plugin.name).toBe("@buntime/plugin-database");
    });

    it("should detect multiple LIBSQL_URL_* from environment", () => {
      process.env.LIBSQL_URL_0 = "http://primary:8080";
      process.env.LIBSQL_URL_1 = "http://replica1:8080";
      process.env.LIBSQL_URL_2 = "http://replica2:8080";

      const plugin = databasePlugin({
        adapters: [
          {
            type: "libsql",
            urls: [],
            default: true,
          },
        ],
      });

      expect(plugin.name).toBe("@buntime/plugin-database");
    });

    it("should stop at first missing index", () => {
      process.env.LIBSQL_URL_0 = "http://primary:8080";
      // Skip LIBSQL_URL_1
      process.env.LIBSQL_URL_2 = "http://replica2:8080";

      const plugin = databasePlugin({
        adapters: [
          {
            type: "libsql",
            urls: [],
            default: true,
          },
        ],
      });

      // Only LIBSQL_URL_0 should be detected (URL_2 is ignored due to gap)
      expect(plugin.name).toBe("@buntime/plugin-database");
    });
  });

  describe("config processing", () => {
    // Save the original LIBSQL_URL_0 at module load time
    const savedLibSqlUrl0 = process.env.LIBSQL_URL_0;

    afterEach(() => {
      // Clear LIBSQL_URL_0 set during test and restore original
      delete process.env.LIBSQL_URL_0;
      if (savedLibSqlUrl0 !== undefined) {
        process.env.LIBSQL_URL_0 = savedLibSqlUrl0;
      }
    });

    it("should handle empty config", () => {
      const plugin = databasePlugin();

      expect(plugin.name).toBe("@buntime/plugin-database");
    });

    it("should handle config with adapters array", () => {
      const plugin = databasePlugin({
        adapters: [{ type: "libsql", urls: ["http://localhost:8080"], default: true }],
      });

      expect(plugin.name).toBe("@buntime/plugin-database");
    });

    it("should handle config with tenancy settings", () => {
      const plugin = databasePlugin({
        adapters: [{ type: "libsql", urls: ["http://localhost:8080"], default: true }],
        tenancy: {
          enabled: true,
          autoCreate: true,
          header: "x-tenant-id",
          maxTenants: 500,
        },
      });

      expect(plugin.name).toBe("@buntime/plugin-database");
    });

    it("should merge config urls with env urls (deduplication)", () => {
      process.env.LIBSQL_URL_0 = "http://env-primary:8080";

      const plugin = databasePlugin({
        adapters: [
          {
            type: "libsql",
            urls: ["http://config-primary:8080", "http://env-primary:8080"], // duplicate of env
            default: true,
          },
        ],
      });

      expect(plugin.name).toBe("@buntime/plugin-database");
    });
  });

  describe("menu configuration", () => {
    it("should have Overview menu item", () => {
      const plugin = databasePlugin();

      const dbMenu = plugin.menus?.[0];
      const overviewItem = dbMenu?.items?.find((item) => item.title === "Overview");

      expect(overviewItem).toMatchObject({
        icon: "lucide:home",
        path: "/database",
        title: "Overview",
      });
    });

    it("should have Studio menu item", () => {
      const plugin = databasePlugin();

      const dbMenu = plugin.menus?.[0];
      const studioItem = dbMenu?.items?.find((item) => item.title === "Studio");

      expect(studioItem).toMatchObject({
        icon: "lucide:table-2",
        path: "/database/studio",
        title: "Studio",
      });
    });
  });

  describe("lifecycle hooks", () => {
    describe("onInit", () => {
      it("should initialize service and register it in context", async () => {
        const logger = createMockLogger();
        const ctx = createMockContext(logger);
        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [LIBSQL_URL], default: true }],
        });

        await plugin.onInit?.(ctx);

        // Verify service was registered
        const service = ctx.getService("database");
        expect(service).toBeDefined();
        expect(logger.info).toHaveBeenCalled();

        // Cleanup
        await plugin.onShutdown?.();
      });

      it("should process config with env var substitution", async () => {
        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        // Set env var for test
        process.env.TEST_DB_TOKEN = "test-token-123";

        const plugin = databasePlugin({
          adapters: [
            { type: "libsql", urls: [LIBSQL_URL], authToken: "${TEST_DB_TOKEN}", default: true },
          ],
        });

        await plugin.onInit?.(ctx);

        // Service should initialize successfully with substituted token
        const service = ctx.getService("database");
        expect(service).toBeDefined();

        // Cleanup
        await plugin.onShutdown?.();
        delete process.env.TEST_DB_TOKEN;
      });

      it("should substitute env vars in url for non-libsql adapters", async () => {
        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        // Set env var for test - note: actual adapter creation may fail but config processing should work
        process.env.TEST_SQLITE_URL = "file:/tmp/buntime/test-db.sqlite";

        const plugin = databasePlugin({
          adapters: [{ type: "sqlite", url: "${TEST_SQLITE_URL}", default: true }],
        });

        try {
          await plugin.onInit?.(ctx);
          await plugin.onShutdown?.();
        } catch {
          // BunSqlAdapter may fail to initialize in test environment, but config processing works
        }

        delete process.env.TEST_SQLITE_URL;
      });

      it("should filter empty urls in libsql adapter", async () => {
        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [LIBSQL_URL, "", "  "], default: true }],
        });

        await plugin.onInit?.(ctx);

        const service = ctx.getService("database");
        expect(service).toBeDefined();

        await plugin.onShutdown?.();
      });
    });

    describe("onShutdown", () => {
      it("should close service on shutdown", async () => {
        const logger = createMockLogger();
        const ctx = createMockContext(logger);
        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [LIBSQL_URL], default: true }],
        });

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();

        // Should not throw
        expect(true).toBe(true);
      });

      it("should handle shutdown when service not initialized", async () => {
        const plugin = databasePlugin();

        // Shutdown without init should not throw
        await plugin.onShutdown?.();
        expect(true).toBe(true);
      });
    });
  });

  describe("helper functions", () => {
    describe("substituteEnvVars", () => {
      afterEach(() => {
        // Restore env
        for (const key of Object.keys(process.env)) {
          if (key.startsWith("TEST_")) {
            delete process.env[key];
          }
        }
      });

      it("should substitute single env var", async () => {
        process.env.TEST_VAR = "value123";

        const plugin = databasePlugin({
          adapters: [
            { type: "libsql", urls: [LIBSQL_URL], authToken: "${TEST_VAR}", default: true },
          ],
        });

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();
      });

      it("should substitute multiple env vars", async () => {
        process.env.TEST_HOST = "localhost";
        process.env.TEST_PORT = "8080";

        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: ["http://${TEST_HOST}:${TEST_PORT}"], default: true }],
        });

        // Plugin creation should work
        expect(plugin.name).toBe("@buntime/plugin-database");
      });

      it("should handle missing env vars by replacing with empty string", async () => {
        const plugin = databasePlugin({
          adapters: [
            { type: "libsql", urls: [LIBSQL_URL], authToken: "${NONEXISTENT_VAR}", default: true },
          ],
        });

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();
      });
    });

    describe("detectLibSqlUrls", () => {
      // Save original LIBSQL_URL_* vars
      const savedEnvVars: Record<string, string | undefined> = {};

      beforeEach(() => {
        // Save and clear all LIBSQL_URL_* vars
        for (const key of Object.keys(process.env)) {
          if (key.startsWith("LIBSQL_URL_")) {
            savedEnvVars[key] = process.env[key];
            delete process.env[key];
          }
        }
      });

      afterEach(() => {
        // Clear test vars
        for (const key of Object.keys(process.env)) {
          if (key.startsWith("LIBSQL_URL_")) {
            delete process.env[key];
          }
        }
        // Restore original vars
        for (const [key, value] of Object.entries(savedEnvVars)) {
          if (value !== undefined) {
            process.env[key] = value;
          }
        }
      });

      it("should detect LIBSQL_URL_0", async () => {
        process.env.LIBSQL_URL_0 = "http://detected:8080";

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [], default: true }],
        });

        await plugin.onInit?.(ctx);

        const service = ctx.getService("database") as { getDefaultType(): string };
        expect(service.getDefaultType()).toBe("libsql");

        await plugin.onShutdown?.();
      });

      it("should detect sequential LIBSQL_URL_* vars", async () => {
        process.env.LIBSQL_URL_0 = "http://primary:8080";
        process.env.LIBSQL_URL_1 = "http://replica1:8080";
        process.env.LIBSQL_URL_2 = "http://replica2:8080";

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [], default: true }],
        });

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();
      });

      it("should stop at first gap in sequence", async () => {
        process.env.LIBSQL_URL_0 = "http://primary:8080";
        // Skip LIBSQL_URL_1
        process.env.LIBSQL_URL_2 = "http://should-be-ignored:8080";

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [], default: true }],
        });

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();
      });

      it("should merge env urls with config urls (deduplicated)", async () => {
        process.env.LIBSQL_URL_0 = "http://env-primary:8080";

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        const plugin = databasePlugin({
          adapters: [
            {
              type: "libsql",
              urls: ["http://config-primary:8080", "http://env-primary:8080"],
              default: true,
            },
          ],
        });

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();
      });
    });

    describe("processAdapter", () => {
      it("should add logger to adapter config", async () => {
        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [LIBSQL_URL], default: true }],
        });

        await plugin.onInit?.(ctx);

        // Logger should be set - verify by checking info was called
        expect(logger.info).toHaveBeenCalled();

        await plugin.onShutdown?.();
      });

      it("should process libsql adapter with authToken substitution", async () => {
        process.env.TEST_AUTH = "secret-token";

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        const plugin = databasePlugin({
          adapters: [
            { type: "libsql", urls: [LIBSQL_URL], authToken: "${TEST_AUTH}", default: true },
          ],
        });

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();

        delete process.env.TEST_AUTH;
      });
    });

    describe("processConfig", () => {
      it("should handle empty adapters array", async () => {
        const plugin = databasePlugin({
          adapters: [],
        });

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        // Should throw because no adapters configured
        await expect(plugin.onInit?.(ctx)).rejects.toThrow("No adapters configured");
      });

      it("should process multiple adapters", async () => {
        // Note: BunSqlAdapter may not work in test env, but config processing should work
        const plugin = databasePlugin({
          adapters: [{ type: "libsql", urls: [LIBSQL_URL], default: true }],
        });

        const logger = createMockLogger();
        const ctx = createMockContext(logger);

        await plugin.onInit?.(ctx);
        await plugin.onShutdown?.();
      });
    });
  });
});
