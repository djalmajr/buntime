import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";
import { LibSqlAdapter } from "../src/adapters/libsql";

const TEST_DB_PATH = "/tmp/test-libsql.db";

describe("LibSqlAdapter", () => {
  let adapter: LibSqlAdapter;

  beforeAll(async () => {
    // Clean up any existing test db
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // File doesn't exist, ignore
    }

    adapter = new LibSqlAdapter({
      type: "libsql",
      url: `file:${TEST_DB_PATH}`,
    });

    // Create test table
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);
  });

  beforeEach(async () => {
    // Clean up test data between tests
    await adapter.execute("DELETE FROM test");
  });

  afterAll(async () => {
    await adapter.close();
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("execute", () => {
    it("should execute a simple SELECT", async () => {
      const rows = await adapter.execute<{ x: number }>("SELECT 1 as x");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.x).toBe(1);
    });

    it("should execute INSERT and SELECT", async () => {
      await adapter.execute("INSERT INTO test (name, value) VALUES (?, ?)", ["test1", 100]);
      const rows = await adapter.execute<{ id: number; name: string; value: number }>(
        "SELECT * FROM test WHERE name = ?",
        ["test1"],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("test1");
      expect(rows[0]?.value).toBe(100);
    });
  });

  describe("executeOne", () => {
    it("should return first row", async () => {
      await adapter.execute("INSERT INTO test (name, value) VALUES (?, ?)", ["first", 100]);
      await adapter.execute("INSERT INTO test (name, value) VALUES (?, ?)", ["second", 200]);

      const row = await adapter.executeOne<{ name: string }>("SELECT name FROM test ORDER BY id");
      expect(row?.name).toBe("first");
    });

    it("should return null if no rows", async () => {
      const row = await adapter.executeOne("SELECT * FROM test WHERE id = ?", [999]);
      expect(row).toBeNull();
    });
  });

  describe("batch", () => {
    it("should execute multiple statements", async () => {
      await adapter.batch([
        { sql: "INSERT INTO test (name, value) VALUES (?, ?)", args: ["batch1", 1] },
        { sql: "INSERT INTO test (name, value) VALUES (?, ?)", args: ["batch2", 2] },
        { sql: "INSERT INTO test (name, value) VALUES (?, ?)", args: ["batch3", 3] },
      ]);

      const rows = await adapter.execute<{ name: string }>("SELECT name FROM test ORDER BY id");
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.name)).toEqual(["batch1", "batch2", "batch3"]);
    });
  });

  describe("transaction", () => {
    it("should commit on success", async () => {
      await adapter.transaction(async (tx) => {
        await tx.execute("INSERT INTO test (name, value) VALUES (?, ?)", ["tx1", 100]);
        await tx.execute("INSERT INTO test (name, value) VALUES (?, ?)", ["tx2", 200]);
      });

      const rows = await adapter.execute("SELECT * FROM test");
      expect(rows).toHaveLength(2);
    });

    it("should rollback on error", async () => {
      try {
        await adapter.transaction(async (tx) => {
          await tx.execute("INSERT INTO test (name, value) VALUES (?, ?)", ["tx1", 100]);
          throw new Error("Test error");
        });
      } catch {
        // Expected
      }

      const rows = await adapter.execute("SELECT * FROM test");
      expect(rows).toHaveLength(0);
    });

    it("should return transaction result", async () => {
      const result = await adapter.transaction(async (tx) => {
        await tx.execute("INSERT INTO test (name, value) VALUES (?, ?)", ["tx1", 100]);
        const row = await tx.executeOne<{ id: number }>("SELECT last_insert_rowid() as id");
        return row?.id;
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe("number");
    });
  });

  describe("getTenant", () => {
    it("should return new adapter with tenant id", async () => {
      // For file-based databases, tenant creates a separate file
      const tenantAdapter = await adapter.getTenant("tenant1");

      expect(tenantAdapter.tenantId).toBe("tenant1");
      expect(tenantAdapter.type).toBe("libsql");

      // Create table in tenant db
      await tenantAdapter.execute(`
        CREATE TABLE IF NOT EXISTS tenant_test (id INTEGER PRIMARY KEY)
      `);

      await tenantAdapter.close();

      // Cleanup tenant file
      try {
        await unlink("/tmp/test-libsql_tenant1.db");
      } catch {
        // Ignore
      }
    });
  });

  describe("createTenant", () => {
    it("should warn when admin URL not configured", async () => {
      const logs: string[] = [];
      const mockLogger = {
        debug: () => {},
        error: () => {},
        info: () => {},
        warn: (msg: string) => logs.push(msg),
      };

      const adapterWithLogger = new LibSqlAdapter({
        type: "libsql",
        url: `file:${TEST_DB_PATH}`,
        logger: mockLogger,
      });

      // Should not throw, just warn
      await adapterWithLogger.createTenant("test-tenant");
      expect(logs[0]).toContain("Admin URL not configured");

      await adapterWithLogger.close();
    });
  });

  describe("deleteTenant", () => {
    it("should throw when admin URL not configured", async () => {
      await expect(adapter.deleteTenant("test-tenant")).rejects.toThrow("Admin URL not configured");
    });
  });

  describe("listTenants", () => {
    it("should throw when admin URL not configured", async () => {
      await expect(adapter.listTenants()).rejects.toThrow("Admin URL not configured");
    });
  });

  describe("URL building", () => {
    it("should handle HTTP URLs for tenants", async () => {
      const httpAdapter = new LibSqlAdapter({
        type: "libsql",
        url: "http://localhost:8080",
      });

      const tenantAdapter = await httpAdapter.getTenant("my-tenant");
      expect(tenantAdapter.tenantId).toBe("my-tenant");

      await httpAdapter.close();
      await tenantAdapter.close();
    });
  });
});
