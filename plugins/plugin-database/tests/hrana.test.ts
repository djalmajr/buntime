import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { PluginLogger } from "@buntime/shared/types";
import { api, setService } from "../server/api";
import type {
  HranaBatchRequest,
  HranaBatchResult,
  HranaExecuteResult,
  HranaPipelineReqBody,
  HranaPipelineRespBody,
} from "../server/hrana/types";
import { DatabaseServiceImpl } from "../server/service";

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

describe("HRANA Pipeline Integration", () => {
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

    // Create a test table
    const adapter = service.getRootAdapter();
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS hrana_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value INTEGER
      )
    `);
  });

  beforeEach(async () => {
    // Clean up test data
    const adapter = service.getRootAdapter();
    await adapter.execute("DELETE FROM hrana_test");
  });

  afterAll(async () => {
    // Drop test table
    const adapter = service.getRootAdapter();
    await adapter.execute("DROP TABLE IF EXISTS hrana_test");
    await service.close();
  });

  describe("POST /api/pipeline", () => {
    it("should execute single statement", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: { sql: "SELECT 1 as x" },
          },
        ],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results).toHaveLength(1);
      expect(json.results[0]?.type).toBe("ok");

      const result = json.results[0] as HranaExecuteResult;
      expect(result.result.rows).toHaveLength(1);
      expect(result.result.rows[0]?.[0]).toEqual({ type: "integer", value: "1" });
    });

    it("should execute INSERT and return affected rows", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('test', 100)" },
          },
        ],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("ok");
    });

    it("should execute with positional args", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: {
              sql: "INSERT INTO hrana_test (name, value) VALUES (?, ?)",
              args: [
                { type: "text", value: "with-args" },
                { type: "integer", value: "42" },
              ],
            },
          },
        ],
      };

      await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Verify the insert
      const selectBody: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "execute",
            stmt: { sql: "SELECT * FROM hrana_test WHERE name = 'with-args'" },
          },
        ],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectBody),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      const result = json.results[0] as HranaExecuteResult;
      expect(result.result.rows).toHaveLength(1);
    });

    it("should execute batch of statements", async () => {
      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('b1', 1)" } },
            { stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('b2', 2)" } },
            { stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('b3', 3)" } },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("ok");

      const batchResult = json.results[0] as HranaBatchResult;
      expect(batchResult.result.step_results).toHaveLength(3);
      expect(batchResult.result.step_results[0]).not.toBeNull();
      expect(batchResult.result.step_results[1]).not.toBeNull();
      expect(batchResult.result.step_results[2]).not.toBeNull();

      // Verify all rows inserted
      const verifyBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT COUNT(*) as count FROM hrana_test" } }],
      };
      const verifyRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyBody),
      });
      const verifyJson = (await verifyRes.json()) as HranaPipelineRespBody;
      const countResult = verifyJson.results[0] as HranaExecuteResult;
      expect(countResult.result.rows[0]?.[0]).toEqual({ type: "integer", value: "3" });
    });

    it("should handle batch with conditional execution (ok condition)", async () => {
      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('first', 1)" } },
            {
              condition: { ok: 0 },
              stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('second', 2)" },
            },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);

      const batchResult = json.results[0] as HranaBatchResult;
      expect(batchResult.result.step_results[0]).not.toBeNull();
      expect(batchResult.result.step_results[1]).not.toBeNull(); // Should run because step 0 succeeded

      // Verify both rows inserted
      const verifyBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT COUNT(*) as count FROM hrana_test" } }],
      };
      const verifyRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyBody),
      });
      const verifyJson = (await verifyRes.json()) as HranaPipelineRespBody;
      const countResult = verifyJson.results[0] as HranaExecuteResult;
      expect(countResult.result.rows[0]?.[0]).toEqual({ type: "integer", value: "2" });
    });

    it("should handle batch with conditional execution (error condition)", async () => {
      const batchRequest: HranaBatchRequest = {
        type: "batch",
        batch: {
          steps: [
            { stmt: { sql: "INSERT INTO nonexistent_table VALUES (1)" } }, // This will fail
            {
              condition: { error: 0 },
              stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('fallback', 99)" },
            },
          ],
        },
      };

      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [batchRequest],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);

      const batchResult = json.results[0] as HranaBatchResult;
      expect(batchResult.result.step_errors[0]).not.toBeNull(); // Step 0 failed
      expect(batchResult.result.step_results[1]).not.toBeNull(); // Step 1 ran because step 0 failed

      // Verify fallback row inserted
      const verifyBody: HranaPipelineReqBody = {
        baton: null,
        requests: [
          { type: "execute", stmt: { sql: "SELECT name FROM hrana_test WHERE value = 99" } },
        ],
      };
      const verifyRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyBody),
      });
      const verifyJson = (await verifyRes.json()) as HranaPipelineRespBody;
      const selectResult = verifyJson.results[0] as HranaExecuteResult;
      expect(selectResult.result.rows[0]?.[0]).toEqual({ type: "text", value: "fallback" });
    });

    it("should handle session with baton for transactions", async () => {
      // Start transaction
      const beginBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "BEGIN TRANSACTION" } }],
      };

      const beginRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(beginBody),
      });
      const beginJson = (await beginRes.json()) as HranaPipelineRespBody;

      expect(beginJson.baton).not.toBeNull();
      const baton = beginJson.baton;

      // Insert with baton
      const insertBody: HranaPipelineReqBody = {
        baton,
        requests: [
          {
            type: "execute",
            stmt: { sql: "INSERT INTO hrana_test (name, value) VALUES ('tx', 1)" },
          },
        ],
      };

      const insertRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(insertBody),
      });
      const insertJson = (await insertRes.json()) as HranaPipelineRespBody;

      expect(insertJson.baton).toBe(baton);

      // Commit
      const commitBody: HranaPipelineReqBody = {
        baton,
        requests: [{ type: "execute", stmt: { sql: "COMMIT" } }],
      };

      await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commitBody),
      });

      // Verify
      const verifyBody: HranaPipelineReqBody = {
        baton: null,
        requests: [
          { type: "execute", stmt: { sql: "SELECT * FROM hrana_test WHERE name = 'tx'" } },
        ],
      };
      const verifyRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyBody),
      });
      const verifyJson = (await verifyRes.json()) as HranaPipelineRespBody;
      const selectResult = verifyJson.results[0] as HranaExecuteResult;
      expect(selectResult.result.rows).toHaveLength(1);
    });

    it("should handle prepared statements with store_sql and sql_id", async () => {
      // Start a session for prepared statements
      const beginBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "BEGIN" } }],
      };

      const beginRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(beginBody),
      });
      const beginJson = (await beginRes.json()) as HranaPipelineRespBody;
      const baton = beginJson.baton;
      expect(baton).not.toBeNull();

      // Store a prepared statement
      const storeBody: HranaPipelineReqBody = {
        baton,
        requests: [
          {
            type: "store_sql",
            sql_id: 1,
            sql: "INSERT INTO hrana_test (name, value) VALUES (?, ?)",
          },
        ],
      };

      const storeRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(storeBody),
      });
      const storeJson = (await storeRes.json()) as HranaPipelineRespBody;
      expect(storeJson.results[0]?.type).toBe("ok");

      // Use the prepared statement
      const execBody: HranaPipelineReqBody = {
        baton: storeJson.baton,
        requests: [
          {
            type: "execute",
            stmt: {
              sql_id: 1,
              args: [
                { type: "text", value: "prepared" },
                { type: "integer", value: "123" },
              ],
            },
          },
        ],
      };

      const execRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(execBody),
      });
      const execJson = (await execRes.json()) as HranaPipelineRespBody;
      expect(execJson.results[0]?.type).toBe("ok");

      // Commit and verify
      const commitBody: HranaPipelineReqBody = {
        baton: execJson.baton,
        requests: [{ type: "execute", stmt: { sql: "COMMIT" } }],
      };
      await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commitBody),
      });

      const verifyBody: HranaPipelineReqBody = {
        baton: null,
        requests: [
          { type: "execute", stmt: { sql: "SELECT * FROM hrana_test WHERE name = 'prepared'" } },
        ],
      };
      const verifyRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyBody),
      });
      const verifyJson = (await verifyRes.json()) as HranaPipelineRespBody;
      const selectResult = verifyJson.results[0] as HranaExecuteResult;
      expect(selectResult.result.rows).toHaveLength(1);
    });

    it("should handle sequence request (SQL script)", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [
          {
            type: "sequence",
            sql: "INSERT INTO hrana_test (name, value) VALUES ('seq1', 1); INSERT INTO hrana_test (name, value) VALUES ('seq2', 2)",
          },
        ],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("ok");

      // Verify both rows
      const verifyBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT COUNT(*) as count FROM hrana_test" } }],
      };
      const verifyRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyBody),
      });
      const verifyJson = (await verifyRes.json()) as HranaPipelineRespBody;
      const countResult = verifyJson.results[0] as HranaExecuteResult;
      expect(countResult.result.rows[0]?.[0]).toEqual({ type: "integer", value: "2" });
    });

    it("should handle describe request", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "describe", sql: "SELECT * FROM hrana_test" }],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("ok");

      const descResult = json.results[0] as {
        result: { is_ddl: boolean; is_readonly: boolean };
        type: "ok";
      };
      expect(descResult.result.is_readonly).toBe(true);
      expect(descResult.result.is_ddl).toBe(false);
    });

    it("should handle get_autocommit request", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "get_autocommit" }],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("ok");

      const acResult = json.results[0] as { is_autocommit: boolean; type: "ok" };
      expect(acResult.is_autocommit).toBe(true);
    });

    it("should handle close request", async () => {
      // Start a session
      const beginBody: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "BEGIN" } }],
      };
      const beginRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(beginBody),
      });
      const beginJson = (await beginRes.json()) as HranaPipelineRespBody;
      const baton = beginJson.baton;
      expect(baton).not.toBeNull();

      // Close the session
      const closeBody: HranaPipelineReqBody = {
        baton,
        requests: [{ type: "close" }],
      };
      const closeRes = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(closeBody),
      });
      const closeJson = (await closeRes.json()) as HranaPipelineRespBody;

      expect(closeJson.results[0]?.type).toBe("ok");
      expect(closeJson.baton).toBeNull(); // Session closed
    });

    it("should return error for invalid baton", async () => {
      const body: HranaPipelineReqBody = {
        baton: "invalid-baton-that-does-not-exist",
        requests: [{ type: "execute", stmt: { sql: "SELECT 1" } }],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("error");
    });

    it("should return error for SQL syntax error", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELEC INVALID SYNTAX" } }],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("error");
    });

    it("should handle adapter type header", async () => {
      const body: HranaPipelineReqBody = {
        baton: null,
        requests: [{ type: "execute", stmt: { sql: "SELECT 1" } }],
      };

      const res = await api.request("/api/pipeline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-database-adapter": "libsql",
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as HranaPipelineRespBody;

      expect(res.status).toBe(200);
      expect(json.results[0]?.type).toBe("ok");
    });
  });
});
