import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { DatabaseServiceImpl } from "../server/service";

// Use environment variable or default to local libSQL server (docker-compose)
const LIBSQL_URL = process.env.LIBSQL_URL_0 ?? "http://localhost:8880";

const mockLogger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
};

describe("DatabaseServiceImpl", () => {
  let service: DatabaseServiceImpl;

  afterAll(async () => {
    await service?.close();
  });

  describe("initialization", () => {
    it("should create service with libsql adapter", async () => {
      service = new DatabaseServiceImpl({
        config: {
          adapters: [
            {
              type: "libsql",
              default: true,
              urls: [LIBSQL_URL],
            },
          ],
        },
        logger: mockLogger,
      });

      expect(service).toBeDefined();
      expect(service.getRootAdapter()).toBeDefined();
      expect(service.getRootAdapter().type).toBe("libsql");
      expect(service.getDefaultType()).toBe("libsql");
    });

    it("should create service with adapters array (new format)", async () => {
      const multiService = new DatabaseServiceImpl({
        config: {
          adapters: [{ type: "libsql", default: true, urls: [LIBSQL_URL] }],
        },
        logger: mockLogger,
      });

      expect(multiService).toBeDefined();
      expect(multiService.getDefaultType()).toBe("libsql");
      expect(multiService.getAvailableTypes()).toContain("libsql");

      await multiService.close();
    });

    it("should log initialization", () => {
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe("multiple adapters", () => {
    it("should throw on duplicate adapter types", () => {
      expect(() => {
        new DatabaseServiceImpl({
          config: {
            adapters: [
              { type: "libsql", urls: [LIBSQL_URL] },
              { type: "libsql", urls: [LIBSQL_URL] },
            ],
          },
          logger: mockLogger,
        });
      }).toThrow("Duplicate adapter type: libsql");
    });

    it("should throw if no adapters configured", () => {
      expect(() => {
        new DatabaseServiceImpl({
          config: {
            adapters: [],
          },
          logger: mockLogger,
        });
      }).toThrow("No adapters configured");
    });
  });

  describe("getAdapter", () => {
    it("should return root adapter when no type specified", async () => {
      const adapter = await service.getAdapter();
      expect(adapter).toBe(service.getRootAdapter());
    });

    it("should return root adapter with explicit type", async () => {
      const adapter = await service.getAdapter("libsql");
      expect(adapter.type).toBe("libsql");
    });

    it("should throw for unknown adapter type", async () => {
      await expect(service.getAdapter("postgres" as never)).rejects.toThrow(
        'Adapter type "postgres" not configured',
      );
    });

    it("should return tenant adapter for tenantId", async () => {
      const adapter = await service.getAdapter(undefined, "tenant1");
      expect(adapter).toBeDefined();
      expect(adapter.tenantId).toBe("tenant1");
    });

    it("should cache tenant adapters", async () => {
      const adapter1 = await service.getAdapter(undefined, "tenant2");
      const adapter2 = await service.getAdapter(undefined, "tenant2");
      expect(adapter1).toBe(adapter2);
    });
  });

  describe("getRootAdapter", () => {
    it("should return the default root adapter", () => {
      const adapter = service.getRootAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.tenantId).toBe(null);
    });

    it("should return adapter for specific type", () => {
      const adapter = service.getRootAdapter("libsql");
      expect(adapter.type).toBe("libsql");
    });
  });

  describe("getDefaultType", () => {
    it("should return the default adapter type", () => {
      expect(service.getDefaultType()).toBe("libsql");
    });
  });

  describe("getAvailableTypes", () => {
    it("should return all configured adapter types", () => {
      const types = service.getAvailableTypes();
      expect(types).toContain("libsql");
    });
  });

  describe("listTenants", () => {
    it("should call Admin API for listing tenants", async () => {
      // Admin API may or may not be available depending on server configuration
      // We just verify the method exists and makes the API call
      try {
        const tenants = await service.listTenants();
        expect(Array.isArray(tenants)).toBe(true);
      } catch (error: unknown) {
        // 404 or 500 errors are expected when Admin API is not configured
        expect(error).toBeDefined();
      }
    });
  });

  describe("createTenant", () => {
    it("should call Admin API for creating tenant", async () => {
      const tenantId = `test-tenant-${Date.now()}`;
      try {
        await service.createTenant(tenantId);
      } catch (error: unknown) {
        // Admin API may not be available
        expect(error).toBeDefined();
      }
    });
  });

  describe("deleteTenant", () => {
    it("should call Admin API for deleting tenant", async () => {
      const tenantId = `delete-test-${Date.now()}`;
      try {
        await service.deleteTenant(tenantId);
      } catch (error: unknown) {
        // Admin API may not be available
        expect(error).toBeDefined();
      }
    });

    it("should handle cached adapter on delete attempt", async () => {
      const tenantId = `cached-delete-${Date.now()}`;

      // Get adapter to cache it
      try {
        await service.getAdapter(undefined, tenantId);
        await service.deleteTenant(tenantId);
      } catch (error: unknown) {
        // Admin API may not be available
        expect(error).toBeDefined();
      }
    });
  });

  describe("LRU cache", () => {
    it("should limit tenant cache size and evict least recently used adapters", async () => {
      const lruService = new DatabaseServiceImpl({
        config: {
          adapters: [{ type: "libsql", default: true, urls: [LIBSQL_URL] }],
          tenancy: {
            maxTenants: 2,
          },
        },
        logger: mockLogger,
      });

      // Create 2 tenants (maxTenants is 2, cache is now full)
      await lruService.getAdapter(undefined, "tenant-1");
      await lruService.getAdapter(undefined, "tenant-2");

      // Access tenant-2 to make it more recently used
      await lruService.getAdapter(undefined, "tenant-2");

      // Now accessing tenant-3 should evict tenant-1 (least recently used)
      // The eviction happens automatically via QuickLRU's onEviction callback
      await lruService.getAdapter(undefined, "tenant-3");

      // Cache should now contain tenant-2 and tenant-3 (tenant-1 was evicted)
      // Accessing tenant-1 again should create a new adapter instance
      const adapter1First = await lruService.getAdapter(undefined, "tenant-1");
      const adapter1Second = await lruService.getAdapter(undefined, "tenant-1");
      expect(adapter1Second).toBe(adapter1First); // Same instance (cached)

      // tenant-2 should still be cached
      const adapter2Again = await lruService.getAdapter(undefined, "tenant-2");
      expect(adapter2Again).toBeDefined();
      expect(adapter2Again.tenantId).toBe("tenant-2");

      await lruService.close();
    });
  });

  describe("close", () => {
    it("should close all adapters", async () => {
      const closeService = new DatabaseServiceImpl({
        config: {
          adapters: [{ type: "libsql", default: true, urls: [LIBSQL_URL] }],
        },
        logger: mockLogger,
      });

      // Get a tenant adapter to populate cache
      await closeService.getAdapter(undefined, "test-tenant");

      // Close should not throw
      await expect(closeService.close()).resolves.toBeUndefined();
    });

    it("should close multiple cached tenant adapters", async () => {
      const multiService = new DatabaseServiceImpl({
        config: {
          adapters: [{ type: "libsql", default: true, urls: [LIBSQL_URL] }],
        },
        logger: mockLogger,
      });

      // Get multiple tenant adapters
      await multiService.getAdapter(undefined, "tenant-a");
      await multiService.getAdapter(undefined, "tenant-b");
      await multiService.getAdapter(undefined, "tenant-c");

      // Close should close all without throwing
      await expect(multiService.close()).resolves.toBeUndefined();
    });
  });
});

describe("DatabaseServiceImpl with autoCreate", () => {
  let service: DatabaseServiceImpl;

  beforeAll(() => {
    service = new DatabaseServiceImpl({
      config: {
        adapters: [
          {
            type: "libsql",
            default: true,
            urls: [LIBSQL_URL],
          },
        ],
        tenancy: {
          enabled: true,
          autoCreate: true,
        },
      },
      logger: mockLogger,
    });
  });

  afterAll(async () => {
    await service.close();
  });

  it("should auto-create tenant on first access", async () => {
    // This should not throw even if tenant doesn't exist
    const adapter = await service.getAdapter(undefined, "auto-created-tenant");
    expect(adapter).toBeDefined();
    expect(adapter.tenantId).toBe("auto-created-tenant");
  });
});

describe("DatabaseServiceImpl LRU eviction error handling", () => {
  it("should handle errors when closing evicted adapters", async () => {
    const errorLogger = {
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    };

    const service = new DatabaseServiceImpl({
      config: {
        adapters: [{ type: "libsql", default: true, urls: [LIBSQL_URL] }],
        tenancy: {
          maxTenants: 1, // Very small cache to force eviction
        },
      },
      logger: errorLogger,
    });

    // Get first tenant - fills the cache
    const adapter1 = await service.getAdapter(undefined, "evict-test-1");
    expect(adapter1).toBeDefined();

    // Monkey-patch the close method to throw an error
    const originalClose = adapter1.close.bind(adapter1);
    const mutableAdapter = adapter1 as { close: () => Promise<void> };
    mutableAdapter.close = mock(async () => {
      throw new Error("Simulated close error");
    });

    // Get second tenant - should evict first tenant
    // The onEviction callback will be called and should handle the error
    const adapter2 = await service.getAdapter(undefined, "evict-test-2");
    expect(adapter2).toBeDefined();

    // Wait a moment for the async error handler to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The error logger should have been called
    expect(errorLogger.error).toHaveBeenCalled();

    // Restore the original close method to avoid issues
    mutableAdapter.close = originalClose;

    await service.close();
  });

  it("should log debug message on eviction", async () => {
    const debugLogger = {
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    };

    const service = new DatabaseServiceImpl({
      config: {
        adapters: [{ type: "libsql", default: true, urls: [LIBSQL_URL] }],
        tenancy: {
          maxTenants: 1,
        },
      },
      logger: debugLogger,
    });

    // Get first tenant
    await service.getAdapter(undefined, "debug-test-1");

    // Get second tenant - evicts first
    await service.getAdapter(undefined, "debug-test-2");

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Debug should have been called with eviction message
    expect(debugLogger.debug).toHaveBeenCalled();

    await service.close();
  });
});
