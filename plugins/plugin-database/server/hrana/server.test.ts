import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { PluginLogger } from "@buntime/shared/types";
import type { AdapterType, DatabaseAdapter, DatabaseService, TransactionAdapter } from "../types";
import { HranaServer } from "./server";
import type {
  HranaBatchRequest,
  HranaBatchResult,
  HranaError,
  HranaExecuteRequest,
  HranaExecuteResult,
  HranaPipelineReqBody,
} from "./types";

// Mock logger
function createMockLogger(): PluginLogger {
  return {
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  };
}

// Mock adapter
function createMockAdapter(
  options: { executeResult?: unknown[]; shouldThrow?: Error } = {},
): DatabaseAdapter {
  const executeFn = async (_sql: string, _args?: unknown[]): Promise<unknown[]> => {
    if (options.shouldThrow) {
      throw options.shouldThrow;
    }
    return options.executeResult ?? [];
  };

  const executeOneFn = async (_sql: string, _args?: unknown[]): Promise<unknown | null> => {
    if (options.shouldThrow) {
      throw options.shouldThrow;
    }
    return options.executeResult?.[0] ?? null;
  };

  const transactionFn = async <T>(fn: (tx: TransactionAdapter) => Promise<T>): Promise<T> => {
    const tx: TransactionAdapter = {
      execute: async () => [],
      executeOne: async () => null,
    };
    return fn(tx);
  };

  return {
    type: "libsql",
    tenantId: null,
    execute: mock(executeFn) as DatabaseAdapter["execute"],
    executeOne: mock(executeOneFn) as DatabaseAdapter["executeOne"],
    batch: mock(async () => {}),
    transaction: mock(transactionFn) as DatabaseAdapter["transaction"],
    getTenant: mock(async (_tenantId: string) => createMockAdapter()),
    createTenant: mock(async () => {}),
    deleteTenant: mock(async () => {}),
    listTenants: mock(async () => []),
    close: mock(async () => {}),
    getRawClient: mock(() => ({})),
  };
}

// Mock service
function createMockService(adapter: DatabaseAdapter): DatabaseService {
  return {
    getAdapter: mock(async () => adapter),
    getRootAdapter: mock(() => adapter),
    getDefaultType: mock(() => "libsql" as const),
    getAvailableTypes: mock(() => ["libsql"] as AdapterType[]),
    createTenant: mock(async () => {}),
    deleteTenant: mock(async () => {}),
    listTenants: mock(async () => []),
  };
}

describe("HranaServer", () => {
  let server: HranaServer;
  let adapter: DatabaseAdapter;
  let service: DatabaseService;
  let logger: PluginLogger;

  beforeEach(() => {
    adapter = createMockAdapter();
    service = createMockService(adapter);
    logger = createMockLogger();
    server = new HranaServer(service, logger);
  });

  describe("handlePipeline", () => {
    it("should handle empty requests", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [],
      };

      const result = await server.handlePipeline(body);

      expect(result.base_url).toBeNull();
      expect(result.results).toEqual([]);
    });

    it("should handle execute request", async () => {
      adapter = createMockAdapter({
        executeResult: [{ id: 1, name: "test" }],
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: { sql: "SELECT * FROM users" },
          },
        ],
      };

      const result = await server.handlePipeline(body);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.type).toBe("ok");
      const execResult = result.results[0] as HranaExecuteResult;
      expect(execResult.result.cols).toHaveLength(2);
      expect(execResult.result.cols[0]?.name).toBe("id");
      expect(execResult.result.cols[1]?.name).toBe("name");
    });

    it("should return error for invalid baton", async () => {
      const body: HranaPipelineReqBody = {
        baton: "invalid-session-id",
        requests: [],
      };

      const result = await server.handlePipeline(body);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.type).toBe("error");
      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("INVALID_BATON");
    });

    it("should create session for transaction-like operations", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: { sql: "BEGIN TRANSACTION" },
          },
        ],
      };

      const result = await server.handlePipeline(body);

      expect(result.baton).toBeDefined();
      expect(result.baton).not.toBeNull();
    });

    it("should close session on close request", async () => {
      // First create a session
      const createBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "BEGIN" } }],
      };
      const createResult = await server.handlePipeline(createBody);
      expect(createResult.baton).not.toBeNull();

      // Now close it
      const closeBody: HranaPipelineReqBody = {
        baton: createResult.baton,
        requests: [{ type: "close" }],
      };
      const closeResult = await server.handlePipeline(closeBody);

      expect(closeResult.baton).toBeNull();
      expect(closeResult.results[0]?.type).toBe("ok");
    });

    it("should handle adapter type header", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT 1" } }],
      };

      await server.handlePipeline(body, "sqlite");

      expect(service.getRootAdapter).toHaveBeenCalledWith("sqlite");
    });

    it("should handle namespace header", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT 1" } }],
      };

      await server.handlePipeline(body, "libsql", "tenant-1");

      expect(service.getAdapter).toHaveBeenCalledWith("libsql", "tenant-1");
    });
  });

  describe("execute request", () => {
    it("should execute SQL with positional args", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: {
              sql: "INSERT INTO users (name, age) VALUES (?, ?)",
              args: [
                { type: "text", value: "John" },
                { type: "integer", value: "30" },
              ],
            },
          },
        ],
      };

      await server.handlePipeline(body);

      expect(adapter.execute).toHaveBeenCalledWith("INSERT INTO users (name, age) VALUES (?, ?)", [
        "John",
        30,
      ]);
    });

    it("should execute SQL with named args", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: {
              sql: "INSERT INTO users (name) VALUES (:name)",
              named_args: [{ name: "name", value: { type: "text", value: "Jane" } }],
            },
          },
        ],
      };

      await server.handlePipeline(body);

      expect(adapter.execute).toHaveBeenCalledWith("INSERT INTO users (name) VALUES (:name)", [
        "Jane",
      ]);
    });

    it("should handle execution errors", async () => {
      const error = new Error("UNIQUE constraint failed");
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "INSERT INTO users (id) VALUES (1)" } }],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("error");
      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.message).toBe("UNIQUE constraint failed");
      expect(errorResult.error.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
    });

    it("should respect want_rows option", async () => {
      adapter = createMockAdapter({ executeResult: [{ id: 1 }] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: { sql: "SELECT * FROM users", want_rows: false },
          },
        ],
      };

      const result = await server.handlePipeline(body);

      const execResult = result.results[0] as HranaExecuteResult;
      expect(execResult.result.rows).toEqual([]);
    });
  });

  describe("batch request", () => {
    it("should execute multiple statements", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "INSERT INTO t (x) VALUES (1)" } },
            { stmt: { sql: "INSERT INTO t (x) VALUES (2)" } },
            { stmt: { sql: "INSERT INTO t (x) VALUES (3)" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("ok");
      const batchResult = result.results[0] as HranaBatchResult;
      expect(batchResult.result.step_results).toHaveLength(3);
      expect(batchResult.result.step_errors).toHaveLength(3);
      expect(adapter.execute).toHaveBeenCalledTimes(3);
    });

    it("should handle step errors independently", async () => {
      let callCount = 0;
      adapter = createMockAdapter();
      (adapter.execute as ReturnType<typeof mock>).mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Step 2 failed");
        }
        return [];
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "INSERT 1" } },
            { stmt: { sql: "INSERT 2" } },
            { stmt: { sql: "INSERT 3" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      expect(batchResult.result.step_results[0]).not.toBeNull();
      expect(batchResult.result.step_results[1]).toBeNull();
      expect(batchResult.result.step_results[2]).not.toBeNull();
      expect(batchResult.result.step_errors[0]).toBeNull();
      expect(batchResult.result.step_errors[1]).not.toBeNull();
      expect(batchResult.result.step_errors[2]).toBeNull();
    });
  });

  describe("batch conditions", () => {
    it("should skip step when ok condition fails", async () => {
      let callCount = 0;
      adapter = createMockAdapter();
      (adapter.execute as ReturnType<typeof mock>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Step 0 failed");
        }
        return [];
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "FAIL" } },
            { condition: { ok: 0 }, stmt: { sql: "SHOULD SKIP" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      // Step 0 failed
      expect(batchResult.result.step_errors[0]).not.toBeNull();
      // Step 1 skipped (ok: 0 condition not met)
      expect(batchResult.result.step_results[1]).toBeNull();
      expect(batchResult.result.step_errors[1]).toBeNull();
      // Only one call (step 1 was skipped)
      expect(callCount).toBe(1);
    });

    it("should run step when ok condition succeeds", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "SUCCESS" } },
            { condition: { ok: 0 }, stmt: { sql: "SHOULD RUN" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      expect(batchResult.result.step_results[0]).not.toBeNull();
      expect(batchResult.result.step_results[1]).not.toBeNull();
    });

    it("should run step when error condition succeeds", async () => {
      let callCount = 0;
      adapter = createMockAdapter();
      (adapter.execute as ReturnType<typeof mock>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Step 0 failed");
        }
        return [];
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "FAIL" } },
            { condition: { error: 0 }, stmt: { sql: "SHOULD RUN ON ERROR" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      expect(batchResult.result.step_errors[0]).not.toBeNull();
      expect(batchResult.result.step_results[1]).not.toBeNull();
    });

    it("should handle NOT condition", async () => {
      let callCount = 0;
      adapter = createMockAdapter();
      (adapter.execute as ReturnType<typeof mock>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Step 0 failed");
        }
        return [];
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "FAIL" } },
            { condition: { not: { ok: 0 } }, stmt: { sql: "RUN IF NOT OK" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      // Step 1 should run because NOT(ok: 0) = NOT(false) = true
      expect(batchResult.result.step_results[1]).not.toBeNull();
    });

    it("should handle AND condition", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "S0" } },
            { stmt: { sql: "S1" } },
            { condition: { and: [{ ok: 0 }, { ok: 1 }] }, stmt: { sql: "S2" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      expect(batchResult.result.step_results[2]).not.toBeNull();
    });

    it("should handle OR condition", async () => {
      let callCount = 0;
      adapter = createMockAdapter();
      (adapter.execute as ReturnType<typeof mock>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Step 0 failed");
        }
        return [];
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "S0 FAIL" } },
            { stmt: { sql: "S1 OK" } },
            { condition: { or: [{ ok: 0 }, { ok: 1 }] }, stmt: { sql: "S2" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      // Step 2 runs because OR(ok: 0, ok: 1) = OR(false, true) = true
      expect(batchResult.result.step_results[2]).not.toBeNull();
    });

    it("should handle is_autocommit condition", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [{ condition: { is_autocommit: true }, stmt: { sql: "SELECT 1" } }],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const result = await server.handlePipeline(body);

      const batchResult = result.results[0] as HranaBatchResult;
      expect(batchResult.result.step_results[0]).not.toBeNull();
    });
  });

  describe("prepared statements", () => {
    it("should store and use prepared statement", async () => {
      adapter = createMockAdapter({ executeResult: [{ id: 1 }] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      // First create a session with BEGIN
      const beginBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "BEGIN" } }],
      };
      const beginResult = await server.handlePipeline(beginBody);
      expect(beginResult.baton).not.toBeNull();

      // Store SQL
      const storeBody: HranaPipelineReqBody = {
        baton: beginResult.baton,
        requests: [
          {
            type: "store_sql",
            sql_id: 1,
            sql: "SELECT * FROM users WHERE id = ?",
          },
        ],
      };
      const storeResult = await server.handlePipeline(storeBody);
      expect(storeResult.results[0]?.type).toBe("ok");

      // Use stored SQL
      const execBody: HranaPipelineReqBody = {
        baton: storeResult.baton,
        requests: [
          {
            type: "execute",
            stmt: {
              sql_id: 1,
              args: [{ type: "integer", value: "42" }],
            },
          },
        ],
      };
      const execResult = await server.handlePipeline(execBody);
      expect(execResult.results[0]?.type).toBe("ok");
      expect(adapter.execute).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?", [42]);
    });

    it("should fail store_sql without session", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "store_sql",
            sql_id: 1,
            sql: "SELECT 1",
          },
        ],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("error");
      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("NO_SESSION");
    });

    it("should close stored SQL", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      // Create session
      const beginBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "BEGIN" } }],
      };
      const beginResult = await server.handlePipeline(beginBody);

      // Store SQL
      const storeBody: HranaPipelineReqBody = {
        baton: beginResult.baton,
        requests: [{ type: "store_sql", sql_id: 1, sql: "SELECT 1" }],
      };
      await server.handlePipeline(storeBody);

      // Close SQL
      const closeBody: HranaPipelineReqBody = {
        baton: beginResult.baton,
        requests: [{ type: "close_sql", sql_id: 1 }],
      };
      const closeResult = await server.handlePipeline(closeBody);
      expect(closeResult.results[0]?.type).toBe("ok");
    });

    it("should fail when using unknown sql_id", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      // Create session
      const beginBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "BEGIN" } }],
      };
      const beginResult = await server.handlePipeline(beginBody);

      // Try to use non-existent sql_id
      const execBody: HranaPipelineReqBody = {
        baton: beginResult.baton,
        requests: [
          {
            type: "execute",
            stmt: { sql_id: 999 },
          },
        ],
      };
      const execResult = await server.handlePipeline(execBody);

      expect(execResult.results[0]?.type).toBe("error");
      const errorResult = execResult.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.message).toContain("sql_id");
    });
  });

  describe("sequence request", () => {
    it("should execute SQL script", async () => {
      adapter = createMockAdapter({ executeResult: [] });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "sequence",
            sql: "CREATE TABLE t (x INT); INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)",
          },
        ],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("ok");
      expect(adapter.execute).toHaveBeenCalledTimes(3);
    });

    it("should return error for missing SQL", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "sequence" }],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("error");
      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("MISSING_SQL");
    });
  });

  describe("describe request", () => {
    it("should describe SELECT as readonly", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "describe", sql: "SELECT * FROM users" }],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("ok");
      const descResult = result.results[0] as {
        result: { is_ddl: boolean; is_explain: boolean; is_readonly: boolean };
        type: "ok";
      };
      expect(descResult.result.is_readonly).toBe(true);
      expect(descResult.result.is_ddl).toBe(false);
    });

    it("should describe CREATE as DDL", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "describe", sql: "CREATE TABLE t (x INT)" }],
      };

      const result = await server.handlePipeline(body);

      const descResult = result.results[0] as {
        result: { is_ddl: boolean; is_readonly: boolean };
        type: "ok";
      };
      expect(descResult.result.is_ddl).toBe(true);
    });

    it("should describe EXPLAIN as explain", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "describe", sql: "EXPLAIN SELECT 1" }],
      };

      const result = await server.handlePipeline(body);

      const descResult = result.results[0] as {
        result: { is_explain: boolean };
        type: "ok";
      };
      expect(descResult.result.is_explain).toBe(true);
    });

    it("should return error for missing SQL", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "describe" }],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("error");
    });
  });

  describe("get_autocommit request", () => {
    it("should return is_autocommit: true", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "get_autocommit" }],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("ok");
      const acResult = result.results[0] as { is_autocommit: boolean; type: "ok" };
      expect(acResult.is_autocommit).toBe(true);
    });
  });

  describe("unknown request type", () => {
    it("should return error for unknown request type", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "unknown_type" } as unknown as HranaExecuteRequest],
      };

      const result = await server.handlePipeline(body);

      expect(result.results[0]?.type).toBe("error");
      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("UNKNOWN_REQUEST");
    });
  });

  describe("error code mapping", () => {
    it("should map UNIQUE constraint error", async () => {
      const error = new Error("UNIQUE constraint failed: users.email");
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "INSERT" } }],
      };

      const result = await server.handlePipeline(body);

      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
    });

    it("should map foreign key constraint error", async () => {
      const error = new Error("FOREIGN KEY constraint failed");
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "INSERT" } }],
      };

      const result = await server.handlePipeline(body);

      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
    });

    it("should map syntax error", async () => {
      const error = new Error('near "SELEC": syntax error');
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELEC 1" } }],
      };

      const result = await server.handlePipeline(body);

      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("SQLITE_ERROR");
    });

    it("should map busy/locked error", async () => {
      const error = new Error("database is locked");
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT" } }],
      };

      const result = await server.handlePipeline(body);

      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("SQLITE_BUSY");
    });

    it("should preserve SQLITE_ prefixed codes", async () => {
      const error = Object.assign(new Error("Some error"), { code: "SQLITE_CONSTRAINT" });
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "INSERT" } }],
      };

      const result = await server.handlePipeline(body);

      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("SQLITE_CONSTRAINT");
    });

    it("should map numeric SQLite error codes", async () => {
      const error = Object.assign(new Error("Constraint failed"), { code: 19 });
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "INSERT" } }],
      };

      const result = await server.handlePipeline(body);

      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("SQLITE_CONSTRAINT");
    });

    it("should map extended numeric SQLite error codes", async () => {
      const error = Object.assign(new Error("UNIQUE constraint failed"), { code: 2067 });
      adapter = createMockAdapter({ shouldThrow: error });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "INSERT" } }],
      };

      const result = await server.handlePipeline(body);

      const errorResult = result.results[0] as { error: HranaError; type: "error" };
      expect(errorResult.error.code).toBe("SQLITE_CONSTRAINT_ROWID");
    });
  });

  describe("result formatting", () => {
    it("should format rows with correct column metadata", async () => {
      adapter = createMockAdapter({
        executeResult: [
          { id: 1, name: "Alice", active: true },
          { id: 2, name: "Bob", active: false },
        ],
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT * FROM users" } }],
      };

      const result = await server.handlePipeline(body);

      const execResult = result.results[0] as HranaExecuteResult;
      expect(execResult.result.cols).toHaveLength(3);
      expect(execResult.result.cols[0]?.name).toBe("id");
      expect(execResult.result.cols[1]?.name).toBe("name");
      expect(execResult.result.cols[2]?.name).toBe("active");
      expect(execResult.result.rows).toHaveLength(2);
    });

    it("should convert values to HRANA format", async () => {
      adapter = createMockAdapter({
        executeResult: [{ num: 42, text: "hello", nil: null, float: 3.14 }],
      });
      service = createMockService(adapter);
      server = new HranaServer(service, logger);

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT" } }],
      };

      const result = await server.handlePipeline(body);

      const execResult = result.results[0] as HranaExecuteResult;
      const row = execResult.result.rows[0];
      expect(row).toBeDefined();
      expect(row?.[0]).toEqual({ type: "integer", value: "42" });
      expect(row?.[1]).toEqual({ type: "text", value: "hello" });
      expect(row?.[2]).toEqual({ type: "null" });
      expect(row?.[3]).toEqual({ type: "float", value: 3.14 });
    });
  });
});
