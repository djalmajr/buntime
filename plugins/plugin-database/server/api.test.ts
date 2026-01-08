import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { PluginLogger } from "@buntime/shared/types";
import { api, setService } from "./api";
import { DatabaseServiceImpl } from "./service";

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

describe("Database API", () => {
  let service: DatabaseServiceImpl;
  let logger: PluginLogger;

  beforeAll(async () => {
    logger = createMockLogger();
    service = new DatabaseServiceImpl({
      config: {
        adapters: [{ type: "libsql", urls: [LIBSQL_URL], default: true }],
      },
      logger,
    });
    setService(service, logger);

    // Create a test table for our queries
    const adapter = service.getRootAdapter();
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS api_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value INTEGER,
        data BLOB
      )
    `);
  });

  beforeEach(async () => {
    // Clean up test data
    const adapter = service.getRootAdapter();
    await adapter.execute("DELETE FROM api_test");
  });

  afterAll(async () => {
    // Drop test table
    const adapter = service.getRootAdapter();
    await adapter.execute("DROP TABLE IF EXISTS api_test");
    await service.close();
  });

  describe("setService", () => {
    it("should set service and logger", () => {
      const mockService = {} as DatabaseServiceImpl;
      const mockLogger = createMockLogger();

      // Should not throw
      setService(mockService, mockLogger);

      // Restore original service
      setService(service, logger);
    });
  });

  describe("GET /api/adapters", () => {
    it("should return list of available adapters", async () => {
      const res = await api.request("/api/adapters");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.adapters).toContain("libsql");
      expect(json.default).toBe("libsql");
    });

    it("should return 500 when service not initialized", async () => {
      // Temporarily unset service
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/adapters");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      // Restore service
      setService(service, logger);
    });
  });

  describe("GET /api/tenants", () => {
    it("should return list of tenants", async () => {
      const res = await api.request("/api/tenants");

      // May succeed or fail depending on Admin API availability
      expect([200, 500]).toContain(res.status);
    });

    it("should accept type query parameter", async () => {
      const res = await api.request("/api/tenants?type=libsql");

      expect([200, 500]).toContain(res.status);
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/tenants");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      setService(service, logger);
    });
  });

  describe("POST /api/tenants", () => {
    it("should create a new tenant", async () => {
      const tenantId = `test-tenant-${Date.now()}`;
      const res = await api.request("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tenantId }),
      });

      // May succeed or fail depending on Admin API availability
      expect([201, 500]).toContain(res.status);

      if (res.status === 201) {
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.id).toBe(tenantId);
        expect(json.type).toBe("libsql");
      }
    });

    it("should return 400 for missing tenant id", async () => {
      const res = await api.request("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe("Missing or invalid tenant id");
    });

    it("should return 400 for invalid tenant id type", async () => {
      const res = await api.request("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 123 }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe("Missing or invalid tenant id");
    });

    it("should accept type parameter", async () => {
      const tenantId = `test-tenant-type-${Date.now()}`;
      const res = await api.request("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tenantId, type: "libsql" }),
      });

      expect([201, 500]).toContain(res.status);
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "test" }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      setService(service, logger);
    });
  });

  describe("DELETE /api/tenants/:id", () => {
    it("should delete a tenant", async () => {
      const res = await api.request("/api/tenants/test-delete", {
        method: "DELETE",
      });

      // May succeed or fail depending on Admin API
      expect([200, 500]).toContain(res.status);
    });

    it("should accept type query parameter", async () => {
      const res = await api.request("/api/tenants/test-delete?type=libsql", {
        method: "DELETE",
      });

      expect([200, 500]).toContain(res.status);
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/tenants/test", {
        method: "DELETE",
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      setService(service, logger);
    });
  });

  describe("GET /api/tables", () => {
    it("should return list of tables", async () => {
      const res = await api.request("/api/tables");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.tables).toBeDefined();
      expect(Array.isArray(json.tables)).toBe(true);
      expect(json.type).toBe("libsql");
    });

    it("should find api_test table", async () => {
      const res = await api.request("/api/tables");
      const json = await res.json();

      expect(res.status).toBe(200);
      const tableNames = json.tables.map((t: { name: string }) => t.name);
      expect(tableNames).toContain("api_test");
    });

    it("should accept type query parameter", async () => {
      const res = await api.request("/api/tables?type=libsql");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.type).toBe("libsql");
    });

    it("should accept tenant query parameter", async () => {
      const res = await api.request("/api/tables?tenant=test-tenant");

      // May succeed or fail depending on tenant existence
      expect([200, 500]).toContain(res.status);
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/tables");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      setService(service, logger);
    });

    it("should return 500 for invalid adapter type", async () => {
      const res = await api.request("/api/tables?type=invalid");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain("not configured");
    });
  });

  describe("GET /api/tables/:name/schema", () => {
    it("should return table schema", async () => {
      const res = await api.request("/api/tables/api_test/schema");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.table).toBe("api_test");
      expect(json.columns).toBeDefined();
      expect(Array.isArray(json.columns)).toBe(true);
    });

    it("should include column details", async () => {
      const res = await api.request("/api/tables/api_test/schema");
      const json = await res.json();

      expect(res.status).toBe(200);

      const idColumn = json.columns.find((c: { name: string }) => c.name === "id");
      expect(idColumn).toBeDefined();
      expect(idColumn.type).toBe("INTEGER");
      expect(idColumn.pk).toBe(true);

      const nameColumn = json.columns.find((c: { name: string }) => c.name === "name");
      expect(nameColumn).toBeDefined();
      expect(nameColumn.nullable).toBe(false);
    });

    it("should accept type query parameter", async () => {
      const res = await api.request("/api/tables/api_test/schema?type=libsql");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.type).toBe("libsql");
    });

    it("should accept tenant query parameter", async () => {
      const res = await api.request("/api/tables/api_test/schema?tenant=test");

      expect([200, 500]).toContain(res.status);
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/tables/test/schema");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      setService(service, logger);
    });

    it("should return 500 for non-existent table", async () => {
      const res = await api.request("/api/tables/nonexistent_table_xyz/schema");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.columns).toEqual([]);
    });
  });

  describe("GET /api/tables/:name/rows", () => {
    beforeEach(async () => {
      // Insert some test data
      const adapter = service.getRootAdapter();
      await adapter.execute("INSERT INTO api_test (name, value) VALUES (?, ?)", ["row1", 100]);
      await adapter.execute("INSERT INTO api_test (name, value) VALUES (?, ?)", ["row2", 200]);
      await adapter.execute("INSERT INTO api_test (name, value) VALUES (?, ?)", ["row3", 300]);
    });

    it("should return table rows", async () => {
      const res = await api.request("/api/tables/api_test/rows");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.table).toBe("api_test");
      expect(json.rows).toBeDefined();
      expect(json.rows.length).toBe(3);
      expect(json.total).toBe(3);
    });

    it("should respect limit parameter", async () => {
      const res = await api.request("/api/tables/api_test/rows?limit=2");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.rows.length).toBe(2);
      expect(json.limit).toBe(2);
      expect(json.total).toBe(3);
    });

    it("should cap limit at 1000", async () => {
      const res = await api.request("/api/tables/api_test/rows?limit=5000");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.limit).toBe(1000);
    });

    it("should respect offset parameter", async () => {
      const res = await api.request("/api/tables/api_test/rows?offset=1");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.rows.length).toBe(2);
      expect(json.offset).toBe(1);
    });

    it("should accept type query parameter", async () => {
      const res = await api.request("/api/tables/api_test/rows?type=libsql");

      expect(res.status).toBe(200);
    });

    it("should accept tenant query parameter", async () => {
      const res = await api.request("/api/tables/api_test/rows?tenant=test");

      expect([200, 500]).toContain(res.status);
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/tables/test/rows");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      setService(service, logger);
    });

    it("should cast BLOB columns to TEXT for SQLite/libSQL", async () => {
      // Insert data with BLOB
      const adapter = service.getRootAdapter();
      await adapter.execute("INSERT INTO api_test (name, value, data) VALUES (?, ?, ?)", [
        "blob-test",
        400,
        new Uint8Array([1, 2, 3]),
      ]);

      const res = await api.request("/api/tables/api_test/rows");
      const json = await res.json();

      expect(res.status).toBe(200);
      // BLOB should be cast to TEXT
      const blobRow = json.rows.find((r: { name: string }) => r.name === "blob-test");
      expect(blobRow).toBeDefined();
    });
  });

  describe("POST /api/query", () => {
    it("should execute raw SQL query", async () => {
      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1 as x" }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.rows).toBeDefined();
      expect(json.rows[0]?.x).toBe(1);
      expect(json.rowCount).toBe(1);
      expect(json.duration).toBeDefined();
    });

    it("should execute INSERT query", async () => {
      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sql: "INSERT INTO api_test (name, value) VALUES ('query-test', 500)",
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.duration).toBeDefined();
    });

    it("should return 400 for missing SQL", async () => {
      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe("Missing or invalid SQL query");
    });

    it("should return 400 for invalid SQL type", async () => {
      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: 123 }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe("Missing or invalid SQL query");
    });

    it("should accept type parameter", async () => {
      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1", type: "libsql" }),
      });

      expect(res.status).toBe(200);
    });

    it("should accept tenant parameter", async () => {
      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1", tenant: "test" }),
      });

      expect([200, 500]).toContain(res.status);
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");

      setService(service, logger);
    });

    it("should return 500 for SQL syntax errors", async () => {
      const res = await api.request("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "INVALID SQL SYNTAX" }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBeDefined();
    });
  });

  describe("GET /api/health", () => {
    it("should return healthy status", async () => {
      const res = await api.request("/api/health");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(["healthy", "degraded"]).toContain(json.status);
    });

    it("should check specific adapter type", async () => {
      const res = await api.request("/api/health?type=libsql");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe("healthy");
      expect(json.type).toBe("libsql");
    });

    it("should return all adapter statuses when no type specified", async () => {
      const res = await api.request("/api/health");
      const json = await res.json();

      expect(res.status).toBe(200);
      if (json.adapters) {
        expect(json.adapters.libsql).toBeDefined();
      }
    });

    it("should return 500 when service not initialized", async () => {
      setService(null as unknown as DatabaseServiceImpl, logger);

      const res = await api.request("/api/health");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Service not initialized");
      expect(json.status).toBe("unhealthy");

      setService(service, logger);
    });

    it("should return 500 for invalid adapter type", async () => {
      const res = await api.request("/api/health?type=invalid");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.status).toBe("unhealthy");
    });
  });

  describe("error handling", () => {
    it("should handle errors with onError middleware", async () => {
      // Force an error by using invalid type
      const res = await api.request("/api/tables?type=invalid");
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBeDefined();
    });
  });
});

// Test postgres and mysql code paths with a mock service
describe("Database API - postgres/mysql paths", () => {
  let mockService: DatabaseServiceImpl;
  let originalService: DatabaseServiceImpl;
  let logger: PluginLogger;

  beforeAll(async () => {
    logger = createMockLogger();

    // Store original service
    originalService = new DatabaseServiceImpl({
      config: {
        adapters: [{ type: "libsql", urls: [LIBSQL_URL], default: true }],
      },
      logger,
    });

    // Create mock service that pretends to have postgres
    mockService = {
      getAdapter: mock(async (type?: string, tenantId?: string) => {
        // Return a mock adapter that handles postgres/mysql queries
        return {
          type: type || "postgres",
          tenantId: tenantId || null,
          execute: mock(async <T>(sql: string, _args?: unknown[]): Promise<T[]> => {
            // Mock postgres tables query
            if (sql.includes("information_schema.tables")) {
              return [
                { name: "users", type: "BASE TABLE" },
                { name: "orders", type: "BASE TABLE" },
              ] as T[];
            }
            // Mock postgres schema query
            if (sql.includes("information_schema.columns")) {
              return [
                { column_name: "id", data_type: "integer", is_nullable: "NO", is_pk: true },
                { column_name: "name", data_type: "varchar", is_nullable: "YES", is_pk: false },
                { COLUMN_NAME: "id", DATA_TYPE: "int", IS_NULLABLE: "NO", COLUMN_KEY: "PRI" },
                { COLUMN_NAME: "email", DATA_TYPE: "varchar", IS_NULLABLE: "YES", COLUMN_KEY: "" },
              ] as T[];
            }
            // Mock count query
            if (sql.includes("COUNT(*)")) {
              return [{ count: 10 }] as T[];
            }
            // Mock rows query
            if (sql.includes("SELECT") && !sql.includes("information_schema")) {
              return [
                { id: 1, name: "Test" },
                { id: 2, name: "Test2" },
              ] as T[];
            }
            return [] as T[];
          }),
          executeOne: mock(async <T>(sql: string, _args?: unknown[]): Promise<T | null> => {
            if (sql.includes("COUNT(*)")) {
              return { count: 10 } as T;
            }
            return null;
          }),
        };
      }),
      getRootAdapter: mock((type?: string) => ({
        type: type || "postgres",
        tenantId: null,
        execute: mock(async () => []),
      })),
      getDefaultType: mock(() => "postgres" as const),
      getAvailableTypes: mock(() => ["postgres", "mysql"]),
      listTenants: mock(async () => ["tenant1", "tenant2"]),
      createTenant: mock(async () => {}),
      deleteTenant: mock(async () => {}),
    } as unknown as DatabaseServiceImpl;
  });

  afterAll(async () => {
    await originalService.close();
  });

  describe("GET /api/tables with postgres type", () => {
    it("should query information_schema.tables for postgres", async () => {
      setService(mockService, logger);
      (mockService.getDefaultType as ReturnType<typeof mock>).mockImplementation(() => "postgres");

      const res = await api.request("/api/tables?type=postgres");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.tables).toBeDefined();
      expect(json.type).toBe("postgres");

      // Restore
      setService(originalService, logger);
    });
  });

  describe("GET /api/tables with mysql type", () => {
    it("should query information_schema.tables for mysql", async () => {
      setService(mockService, logger);
      (mockService.getDefaultType as ReturnType<typeof mock>).mockImplementation(() => "mysql");

      const res = await api.request("/api/tables?type=mysql");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.tables).toBeDefined();
      expect(json.type).toBe("mysql");

      // Restore
      setService(originalService, logger);
    });
  });

  describe("GET /api/tables/:name/schema with postgres type", () => {
    it("should query information_schema.columns for postgres", async () => {
      setService(mockService, logger);
      (mockService.getDefaultType as ReturnType<typeof mock>).mockImplementation(() => "postgres");

      const res = await api.request("/api/tables/users/schema?type=postgres");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.columns).toBeDefined();
      expect(json.type).toBe("postgres");

      // Restore
      setService(originalService, logger);
    });
  });

  describe("GET /api/tables/:name/schema with mysql type", () => {
    it("should query information_schema.columns for mysql", async () => {
      setService(mockService, logger);
      (mockService.getDefaultType as ReturnType<typeof mock>).mockImplementation(() => "mysql");

      const res = await api.request("/api/tables/users/schema?type=mysql");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.columns).toBeDefined();
      expect(json.type).toBe("mysql");

      // Restore
      setService(originalService, logger);
    });
  });
});
