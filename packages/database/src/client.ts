/**
 * Database Client
 *
 * HTTP client for communicating with the HRANA server running in the main thread.
 * Workers use this client to execute database operations.
 */

import {
  type AdapterType,
  type DatabaseClientConfig,
  HranaHeaders,
  type HranaPipelineReqBody,
  type HranaPipelineRespBody,
  type HranaStmt,
  type HranaStmtResult,
  type HranaStreamRequest,
  type HranaValue,
  type ResultSet,
  type Row,
  type Statement,
  type Transaction,
} from "./types";

/**
 * Resolve base URL from environment or default
 */
function resolveBaseUrl(baseUrl?: string): string {
  if (baseUrl) {
    return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }

  // Check for environment variable (DATABASE_API_URL or BUNTIME_API_URL)
  const env = typeof process !== "undefined" ? process.env : undefined;
  if (env?.DATABASE_API_URL) {
    const url = env.DATABASE_API_URL;
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }

  // Workers receive BUNTIME_API_URL from the runtime
  if (env?.BUNTIME_API_URL) {
    const url = `${env.BUNTIME_API_URL}/database/api`;
    return url;
  }

  // Default: relative URL for same-origin requests (browser context)
  return "/database/api";
}

/**
 * Convert a JavaScript value to HRANA value
 */
function toHranaValue(value: unknown): HranaValue {
  if (value === null || value === undefined) {
    return { type: "null" };
  }

  if (typeof value === "string") {
    return { type: "text", value };
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { type: "integer", value: String(value) };
    }
    return { type: "float", value };
  }

  if (typeof value === "bigint") {
    return { type: "integer", value: String(value) };
  }

  if (typeof value === "boolean") {
    return { type: "integer", value: value ? "1" : "0" };
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    const base64 = btoa(String.fromCharCode(...bytes));
    return { type: "blob", base64 };
  }

  // Fallback: convert to string
  return { type: "text", value: String(value) };
}

/**
 * Convert HRANA value to JavaScript value
 */
function fromHranaValue(value: HranaValue): unknown {
  switch (value.type) {
    case "null":
      return null;
    case "text":
      return value.value;
    case "integer": {
      const num = Number(value.value);
      if (Number.isSafeInteger(num)) {
        return num;
      }
      return BigInt(value.value);
    }
    case "float":
      return value.value;
    case "blob": {
      const binary = atob(value.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    default:
      return null;
  }
}

/**
 * Convert HRANA result to ResultSet
 */
function toResultSet(result: HranaStmtResult): ResultSet {
  const columns = result.cols.map((col) => col.name ?? "");
  const rows: Row[] = [];

  for (const row of result.rows) {
    const obj: Row = {};
    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i];
      const value = row[i];
      if (colName !== undefined && value !== undefined) {
        obj[colName] = fromHranaValue(value);
      }
    }
    rows.push(obj);
  }

  return {
    affectedRows: result.affected_row_count,
    columns,
    lastInsertRowid: result.last_insert_rowid ? BigInt(result.last_insert_rowid) : null,
    rows,
  };
}

/**
 * Type guard for error results
 */
function isErrorResult(result: unknown): result is { error: { message: string }; type: "error" } {
  return (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    (result as { type: string }).type === "error" &&
    "error" in result
  );
}

/**
 * Type guard for execute results
 */
function isExecuteResult(result: unknown): result is { result: HranaStmtResult; type: "ok" } {
  return (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    (result as { type: string }).type === "ok" &&
    "result" in result
  );
}

/**
 * Type guard for batch results
 */
function isBatchResult(
  result: unknown,
): result is { result: { step_results: (HranaStmtResult | null)[] }; type: "ok" } {
  return (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    (result as { type: string }).type === "ok" &&
    "result" in result &&
    typeof (result as { result: unknown }).result === "object" &&
    (result as { result: { step_results?: unknown } }).result !== null &&
    "step_results" in ((result as { result: object }).result as object)
  );
}

/**
 * Database Client
 *
 * Provides database access via HRANA protocol over HTTP.
 */
export class DatabaseClient {
  private readonly adapter: AdapterType;
  private readonly baseUrl: string;
  private readonly namespace?: string;

  constructor(config: DatabaseClientConfig) {
    this.adapter = config.adapter;
    this.baseUrl = resolveBaseUrl(config.baseUrl);
    this.namespace = config.namespace;
  }

  /**
   * Execute a SQL statement
   */
  async execute(sql: string, args?: unknown[]): Promise<ResultSet> {
    const stmt: HranaStmt = {
      sql,
      args: args?.map(toHranaValue),
      want_rows: true,
    };

    const response = await this.pipeline([{ type: "execute", stmt }]);
    const result = response.results[0];

    if (!result) {
      return { affectedRows: 0, columns: [], lastInsertRowid: null, rows: [] };
    }

    if (isErrorResult(result)) {
      throw new Error(result.error.message);
    }

    if (isExecuteResult(result)) {
      return toResultSet(result.result);
    }

    // Empty result
    return { affectedRows: 0, columns: [], lastInsertRowid: null, rows: [] };
  }

  /**
   * Execute multiple statements in a batch
   */
  async batch(statements: Statement[]): Promise<ResultSet[]> {
    const steps = statements.map((stmt) => ({
      condition: null,
      stmt: {
        sql: stmt.sql,
        args: stmt.args?.map(toHranaValue),
        want_rows: true,
      },
    }));

    const response = await this.pipeline([{ type: "batch", batch: { steps } }]);

    const result = response.results[0];

    if (!result) {
      return [];
    }

    if (isErrorResult(result)) {
      throw new Error(result.error.message);
    }

    if (isBatchResult(result)) {
      return result.result.step_results.map((r) =>
        r ? toResultSet(r) : { affectedRows: 0, columns: [], lastInsertRowid: null, rows: [] },
      );
    }

    return [];
  }

  /**
   * Execute a function within a transaction
   */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // Start transaction
    let baton: string | null = null;

    try {
      // BEGIN
      const beginResponse = await this.pipeline(
        [{ type: "execute", stmt: { sql: "BEGIN" } }],
        baton,
      );
      baton = beginResponse.baton;

      // Create transaction interface
      const tx: Transaction = {
        execute: async (sql: string, args?: unknown[]) => {
          const stmt: HranaStmt = { sql, args: args?.map(toHranaValue), want_rows: true };
          const response = await this.pipeline([{ type: "execute", stmt }], baton);
          baton = response.baton;

          const result = response.results[0];

          if (!result) {
            return { affectedRows: 0, columns: [], lastInsertRowid: null, rows: [] };
          }

          if (isErrorResult(result)) {
            throw new Error(result.error.message);
          }

          if (isExecuteResult(result)) {
            return toResultSet(result.result);
          }

          return { affectedRows: 0, columns: [], lastInsertRowid: null, rows: [] };
        },

        batch: async (statements: Statement[]) => {
          const steps = statements.map((stmt) => ({
            condition: null,
            stmt: { sql: stmt.sql, args: stmt.args?.map(toHranaValue), want_rows: true },
          }));

          const response = await this.pipeline([{ type: "batch", batch: { steps } }], baton);
          baton = response.baton;

          const result = response.results[0];

          if (!result) {
            return [];
          }

          if (isErrorResult(result)) {
            throw new Error(result.error.message);
          }

          if (isBatchResult(result)) {
            return result.result.step_results.map((r) =>
              r
                ? toResultSet(r)
                : { affectedRows: 0, columns: [], lastInsertRowid: null, rows: [] },
            );
          }

          return [];
        },

        commit: async () => {
          await this.pipeline([{ type: "execute", stmt: { sql: "COMMIT" } }], baton);
          baton = null;
        },

        rollback: async () => {
          await this.pipeline([{ type: "execute", stmt: { sql: "ROLLBACK" } }], baton);
          baton = null;
        },
      };

      // Execute user function
      const result = await fn(tx);

      // Commit
      await tx.commit();

      return result;
    } catch (error) {
      // Rollback on error
      if (baton) {
        try {
          await this.pipeline([{ type: "execute", stmt: { sql: "ROLLBACK" } }], baton);
        } catch {
          // Ignore rollback errors
        }
      }
      throw error;
    }
  }

  /**
   * Get a client compatible with libsql/drizzle
   *
   * This returns an object that can be used with:
   * - drizzle-orm/libsql/http
   * - @libsql/client (subset)
   */
  getRawClient(): LibSqlCompatibleClient {
    return new LibSqlCompatibleClient(this);
  }

  /**
   * Execute a pipeline request
   */
  private async pipeline(
    requests: HranaStreamRequest[],
    baton: string | null = null,
  ): Promise<HranaPipelineRespBody> {
    const body: HranaPipelineReqBody = { baton, requests };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Mark as internal request (worker-to-runtime) to bypass CSRF Origin check
      [HranaHeaders.INTERNAL]: "true",
      [HranaHeaders.ADAPTER]: this.adapter,
    };

    if (this.namespace) {
      headers[HranaHeaders.NAMESPACE] = this.namespace;
    }

    const response = await fetch(`${this.baseUrl}/pipeline`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Database request failed: ${response.status} ${text}`);
    }

    return (await response.json()) as HranaPipelineRespBody;
  }
}

/**
 * LibSQL-compatible client wrapper
 *
 * This provides an interface compatible with @libsql/client
 * so it can be used with drizzle-orm/libsql/http
 */
export class LibSqlCompatibleClient {
  private readonly client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.client = client;
  }

  /**
   * Execute a SQL statement (libsql-client compatible)
   */
  async execute(stmt: string | { sql: string; args?: unknown[] }): Promise<LibSqlResult> {
    const sql = typeof stmt === "string" ? stmt : stmt.sql;
    const args = typeof stmt === "string" ? undefined : stmt.args;

    const result = await this.client.execute(sql, args);

    // Convert to libsql format
    return {
      columns: result.columns,
      columnTypes: result.columns.map(() => ""), // We don't have type info
      lastInsertRowid: result.lastInsertRowid,
      rows: result.rows.map((row) => result.columns.map((col) => row[col])),
      rowsAffected: result.affectedRows,
    };
  }

  /**
   * Execute multiple statements in a batch
   */
  async batch(
    statements: Array<string | { sql: string; args?: unknown[] }>,
  ): Promise<LibSqlResult[]> {
    const stmts: Statement[] = statements.map((stmt) => ({
      sql: typeof stmt === "string" ? stmt : stmt.sql,
      args: typeof stmt === "string" ? undefined : stmt.args,
    }));

    const results = await this.client.batch(stmts);

    return results.map((result) => ({
      columns: result.columns,
      columnTypes: result.columns.map(() => ""),
      lastInsertRowid: result.lastInsertRowid,
      rows: result.rows.map((row) => result.columns.map((col) => row[col])),
      rowsAffected: result.affectedRows,
    }));
  }

  /**
   * Start an interactive transaction
   */
  async transaction(_mode?: "write" | "read" | "deferred"): Promise<LibSqlTransaction> {
    // For now, we don't support interactive transactions
    // Use the DatabaseClient.transaction() method instead
    throw new Error(
      "Interactive transactions not supported. Use DatabaseClient.transaction() instead.",
    );
  }
}

/**
 * LibSQL result format
 */
export interface LibSqlResult {
  columns: string[];
  columnTypes: string[];
  lastInsertRowid: bigint | null;
  rows: unknown[][];
  rowsAffected: number;
}

/**
 * LibSQL transaction interface (placeholder)
 */
export interface LibSqlTransaction {
  execute(stmt: string | { sql: string; args?: unknown[] }): Promise<LibSqlResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Create a database client
 */
export function createClient(config: DatabaseClientConfig): DatabaseClient {
  return new DatabaseClient(config);
}
