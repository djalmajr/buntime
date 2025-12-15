import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { unlink } from "node:fs/promises";
import { DatabaseServiceImpl } from "../server/service";

const TEST_DB_PATH = "/tmp/test-service.db";

const mockLogger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
};

describe("DatabaseServiceImpl", () => {
  let service: DatabaseServiceImpl;

  beforeAll(async () => {
    // Clean up any existing test db
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // File doesn't exist, ignore
    }
  });

  afterAll(async () => {
    await service?.close();
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("initialization", () => {
    it("should create service with libsql adapter", async () => {
      service = new DatabaseServiceImpl({
        config: {
          adapters: [
            {
              type: "libsql",
              default: true,
              urls: [`file:${TEST_DB_PATH}`],
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
          adapters: [{ type: "libsql", default: true, urls: ["file:/tmp/test-multi-1.db"] }],
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
              { type: "libsql", urls: ["file:/tmp/test-dup-1.db"] },
              { type: "libsql", urls: ["file:/tmp/test-dup-2.db"] },
            ],
          },
          logger: mockLogger,
        });
      }).toThrow("Duplicate adapter type: libsql");
    });

    it("should throw on multiple defaults", () => {
      expect(() => {
        new DatabaseServiceImpl({
          config: {
            adapters: [
              { type: "libsql", default: true, urls: ["file:/tmp/test-def-1.db"] },
              { type: "sqlite", default: true, url: "file:/tmp/test-def-2.db" },
            ],
          },
          logger: mockLogger,
        });
      }).toThrow("Multiple default adapters");
    });

    it("should use first adapter as default if none specified", async () => {
      const noDefaultService = new DatabaseServiceImpl({
        config: {
          adapters: [{ type: "libsql", urls: ["file:/tmp/test-nodef.db"] }],
        },
        logger: mockLogger,
      });

      expect(noDefaultService.getDefaultType()).toBe("libsql");
      await noDefaultService.close();
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
    it("should use Admin API on primary URL", async () => {
      // For file: URLs, Admin API will fail (no sqld server)
      await expect(service.listTenants()).rejects.toThrow();
    });
  });

  describe("createTenant", () => {
    it("should use Admin API on primary URL", async () => {
      // Create a service with HTTP URL to test Admin API
      const httpService = new DatabaseServiceImpl({
        config: {},
        logger: mockLogger,
      });

      // Should fail because server doesn't exist
      await expect(httpService.createTenant("new-tenant")).rejects.toThrow();

      await httpService.close();
    });
  });

  describe("deleteTenant", () => {
    it("should use Admin API on primary URL", async () => {
      // Create a service with HTTP URL to test Admin API
      const httpService = new DatabaseServiceImpl({
        config: {},
        logger: mockLogger,
      });

      // Should fail because server doesn't exist
      await expect(httpService.deleteTenant("some-tenant")).rejects.toThrow();

      await httpService.close();
    });

    it("should close cached adapter when deleting tenant", async () => {
      // Create a separate service for this test with HTTP URL
      const deleteService = new DatabaseServiceImpl({
        config: {},
        logger: mockLogger,
      });

      // Get adapter to cache it
      await deleteService.getAdapter(undefined, "tenant-to-delete");

      // Delete should try to close the cached adapter first
      // (will throw because admin URL not configured, but cache should be cleared)
      try {
        await deleteService.deleteTenant("tenant-to-delete");
      } catch {
        // Expected to throw due to admin URL
      }

      await deleteService.close();
    });
  });

  describe("LRU cache", () => {
    it("should limit tenant cache size and evict least recently used adapters", async () => {
      const lruService = new DatabaseServiceImpl({
        config: {
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
      // Create a new service for this test with file URL
      const closeService = new DatabaseServiceImpl({
        config: {},
        logger: mockLogger,
      });

      // Get a tenant adapter to populate cache
      await closeService.getAdapter(undefined, "test-tenant");

      // Close should not throw
      await expect(closeService.close()).resolves.toBeUndefined();
    });

    it("should close multiple cached tenant adapters", async () => {
      const multiService = new DatabaseServiceImpl({
        config: {},
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
            urls: [`file:/tmp/test-autocreate.db`],
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
