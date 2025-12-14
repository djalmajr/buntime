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
          adapter: {
            type: "libsql",
            urls: [`file:${TEST_DB_PATH}`],
          },
        },
        logger: mockLogger,
      });

      expect(service).toBeDefined();
      expect(service.getRootAdapter()).toBeDefined();
      expect(service.getRootAdapter().type).toBe("libsql");
    });

    it("should log initialization", () => {
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe("getAdapter", () => {
    it("should return root adapter when no tenantId", async () => {
      const adapter = await service.getAdapter();
      expect(adapter).toBe(service.getRootAdapter());
    });

    it("should return root adapter for undefined tenantId", async () => {
      const adapter = await service.getAdapter(undefined);
      expect(adapter).toBe(service.getRootAdapter());
    });

    it("should return tenant adapter for tenantId", async () => {
      const adapter = await service.getAdapter("tenant1");
      expect(adapter).toBeDefined();
      expect(adapter.tenantId).toBe("tenant1");
    });

    it("should cache tenant adapters", async () => {
      const adapter1 = await service.getAdapter("tenant2");
      const adapter2 = await service.getAdapter("tenant2");
      expect(adapter1).toBe(adapter2);
    });
  });

  describe("getRootAdapter", () => {
    it("should return the root adapter", () => {
      const adapter = service.getRootAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.tenantId).toBe(null);
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
        config: {
          adapter: {
            type: "libsql",
            urls: ["http://localhost:9999"],
          },
        },
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
        config: {
          adapter: {
            type: "libsql",
            urls: ["http://localhost:9999"],
          },
        },
        logger: mockLogger,
      });

      // Should fail because server doesn't exist
      await expect(httpService.deleteTenant("some-tenant")).rejects.toThrow();

      await httpService.close();
    });

    it("should close cached adapter when deleting tenant", async () => {
      // Create a separate service for this test with HTTP URL
      const deleteService = new DatabaseServiceImpl({
        config: {
          adapter: {
            type: "libsql",
            urls: ["http://localhost:9999"],
          },
        },
        logger: mockLogger,
      });

      // Get adapter to cache it
      await deleteService.getAdapter("tenant-to-delete");

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

  describe("close", () => {
    it("should close all adapters", async () => {
      // Create a new service for this test with file URL
      const closeService = new DatabaseServiceImpl({
        config: {
          adapter: {
            type: "libsql",
            urls: ["file:/tmp/test-close.db"],
          },
        },
        logger: mockLogger,
      });

      // Get a tenant adapter to populate cache
      await closeService.getAdapter("test-tenant");

      // Close should not throw
      await expect(closeService.close()).resolves.toBeUndefined();
    });

    it("should close multiple cached tenant adapters", async () => {
      const multiService = new DatabaseServiceImpl({
        config: {
          adapter: {
            type: "libsql",
            urls: ["file:/tmp/test-multi-close.db"],
          },
        },
        logger: mockLogger,
      });

      // Get multiple tenant adapters
      await multiService.getAdapter("tenant-a");
      await multiService.getAdapter("tenant-b");
      await multiService.getAdapter("tenant-c");

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
        adapter: {
          type: "libsql",
          urls: ["file:/tmp/test-autocreate.db"],
        },
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
    const adapter = await service.getAdapter("auto-created-tenant");
    expect(adapter).toBeDefined();
    expect(adapter.tenantId).toBe("auto-created-tenant");
  });
});
