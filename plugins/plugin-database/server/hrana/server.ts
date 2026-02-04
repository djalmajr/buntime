/**
 * HRANA Server Implementation
 *
 * Implements the HRANA 3 protocol for database access from workers.
 * Workers communicate via HTTP to this server, which translates
 * requests to the appropriate database adapter.
 */

import type { PluginLogger } from "@buntime/shared/types";
import { splitList } from "@buntime/shared/utils/string";
import type { DatabaseAdapter, DatabaseService } from "../types";
import {
  fromHranaValue,
  type HranaBatchCondition,
  type HranaBatchRequest,
  type HranaBatchResult,
  type HranaCloseSqlRequest,
  type HranaColumn,
  type HranaError,
  type HranaErrorResult,
  type HranaExecuteRequest,
  type HranaExecuteResult,
  type HranaPipelineReqBody,
  type HranaPipelineRespBody,
  type HranaStmt,
  type HranaStmtResult,
  type HranaStoreSqlRequest,
  type HranaStreamRequest,
  type HranaStreamResult,
  type HranaValue,
  toHranaValue,
} from "./types";

/**
 * Session state for baton-based transactions
 */
interface Session {
  adapter: DatabaseAdapter;
  createdAt: number;
  id: string;
  inTransaction: boolean;
  /** Stored SQL for prepared statements */
  storedSql: Map<number, string>;
}

/**
 * Session manager for baton-based continuity
 */
class SessionManager {
  private readonly maxAge: number;
  private readonly sessions = new Map<string, Session>();

  constructor(maxAgeMs = 30000) {
    this.maxAge = maxAgeMs;
  }

  create(adapter: DatabaseAdapter): string {
    const id = crypto.randomUUID();
    this.sessions.set(id, {
      adapter,
      createdAt: Date.now(),
      id,
      inTransaction: false,
      storedSql: new Map(),
    });
    return id;
  }

  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    // Check if session expired
    if (Date.now() - session.createdAt > this.maxAge) {
      this.sessions.delete(id);
      return undefined;
    }

    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > this.maxAge) {
        this.sessions.delete(id);
      }
    }
  }
}

/**
 * HRANA Server
 *
 * Handles pipeline requests and translates them to database operations.
 */
export class HranaServer {
  private readonly service: DatabaseService;
  private readonly sessions: SessionManager;
  /** Current session during request processing (for prepared statements) */
  private currentSession: Session | null = null;

  constructor(service: DatabaseService, _logger: PluginLogger) {
    this.service = service;
    this.sessions = new SessionManager();

    // Cleanup expired sessions periodically
    setInterval(() => this.sessions.cleanup(), 60000);
  }

  /**
   * Handle a pipeline request
   */
  async handlePipeline(
    body: HranaPipelineReqBody,
    adapterType?: string,
    namespace?: string,
  ): Promise<HranaPipelineRespBody> {
    let adapter: DatabaseAdapter;
    let sessionId: string | null = null;
    let session: Session | null = null;

    // Get or create session
    if (body.baton) {
      session = this.sessions.get(body.baton) ?? null;
      if (!session) {
        return {
          base_url: null,
          baton: null,
          results: [
            {
              error: { code: "INVALID_BATON", message: "Session expired or invalid" },
              type: "error",
            },
          ],
        };
      }
      adapter = session.adapter;
      sessionId = session.id;
    } else {
      // Get adapter for this request
      adapter = await this.getAdapter(adapterType, namespace);
    }

    // Set current session for prepared statement access
    this.currentSession = session;

    // Process each request
    const results: HranaStreamResult[] = [];
    let shouldCloseBaton = false;

    try {
      for (const request of body.requests) {
        try {
          const result = await this.processRequest(request, adapter);
          results.push(result);

          // Check if we need to close the session
          if (request.type === "close") {
            shouldCloseBaton = true;
          }
        } catch (error) {
          results.push(this.createErrorResult(error));
        }
      }
    } finally {
      // Clear current session
      this.currentSession = null;
    }

    // Manage baton
    let baton: string | null = null;

    if (shouldCloseBaton && sessionId) {
      this.sessions.delete(sessionId);
    } else if (sessionId) {
      // Continue existing session
      baton = sessionId;
    } else if (this.needsSession(body.requests)) {
      // Create new session for transaction-like operations
      baton = this.sessions.create(adapter);
    }

    return {
      base_url: null,
      baton,
      results,
    };
  }

  /**
   * Check if requests need a session (for transactions)
   */
  private needsSession(requests: HranaStreamRequest[]): boolean {
    // If there's a batch with BEGIN/COMMIT, we need a session
    for (const req of requests) {
      if (req.type === "batch") {
        const batch = req as HranaBatchRequest;
        for (const step of batch.batch.steps) {
          const sql = step.stmt.sql?.toUpperCase() ?? "";
          if (sql.startsWith("BEGIN") || sql.includes("TRANSACTION")) {
            return true;
          }
        }
      }
      if (req.type === "execute") {
        const exec = req as HranaExecuteRequest;
        const sql = exec.stmt.sql?.toUpperCase() ?? "";
        if (sql.startsWith("BEGIN") || sql.includes("TRANSACTION")) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get database adapter based on type and namespace
   */
  private async getAdapter(adapterType?: string, namespace?: string): Promise<DatabaseAdapter> {
    const type = adapterType as "libsql" | "mysql" | "postgres" | "sqlite" | undefined;

    if (namespace) {
      return this.service.getAdapter(type, namespace);
    }

    return this.service.getRootAdapter(type);
  }

  /**
   * Process a single stream request
   */
  private async processRequest(
    request: HranaStreamRequest,
    adapter: DatabaseAdapter,
  ): Promise<HranaStreamResult> {
    switch (request.type) {
      case "execute":
        return this.handleExecute(request, adapter);

      case "batch":
        return this.handleBatch(request, adapter);

      case "close":
        return { type: "ok" };

      case "store_sql":
        return this.handleStoreSql(request);

      case "close_sql":
        return this.handleCloseSql(request);

      case "sequence":
        return this.handleSequence(request, adapter);

      case "describe":
        return this.handleDescribe(request, adapter);

      case "get_autocommit":
        return { is_autocommit: true, type: "ok" };

      default:
        return {
          error: {
            code: "UNKNOWN_REQUEST",
            message: `Unknown request type: ${(request as { type: string }).type}`,
          },
          type: "error",
        };
    }
  }

  /**
   * Handle store_sql request (prepared statements)
   */
  private handleStoreSql(request: HranaStoreSqlRequest): HranaStreamResult {
    if (!this.currentSession) {
      return {
        error: {
          code: "NO_SESSION",
          message: "store_sql requires a session (baton)",
        },
        type: "error",
      };
    }

    this.currentSession.storedSql.set(request.sql_id, request.sql);
    return { type: "ok" };
  }

  /**
   * Handle close_sql request (release prepared statement)
   */
  private handleCloseSql(request: HranaCloseSqlRequest): HranaStreamResult {
    if (this.currentSession) {
      this.currentSession.storedSql.delete(request.sql_id);
    }
    return { type: "ok" };
  }

  /**
   * Handle execute request
   */
  private async handleExecute(
    request: HranaExecuteRequest,
    adapter: DatabaseAdapter,
  ): Promise<HranaExecuteResult | HranaErrorResult> {
    try {
      const { sql, args } = this.prepareStatement(request.stmt);
      const rows = await adapter.execute(sql, args);
      const result = this.createStmtResult(rows, request.stmt);

      return { result, type: "ok" };
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

  /**
   * Handle batch request with conditional execution
   */
  private async handleBatch(
    request: HranaBatchRequest,
    adapter: DatabaseAdapter,
  ): Promise<HranaBatchResult | HranaErrorResult> {
    const stepResults: (HranaStmtResult | null)[] = [];
    const stepErrors: (HranaError | null)[] = [];

    // Execute each step individually to support conditions
    for (let i = 0; i < request.batch.steps.length; i++) {
      const step = request.batch.steps[i];
      if (!step) {
        stepResults.push(null);
        stepErrors.push(null);
        continue;
      }

      // Evaluate condition
      const shouldRun = this.evaluateCondition(step.condition, stepResults, stepErrors);

      if (!shouldRun) {
        // Step skipped due to condition
        stepResults.push(null);
        stepErrors.push(null);
        continue;
      }

      try {
        const { sql, args } = this.prepareStatement(step.stmt);
        const rows = await adapter.execute(sql, args);
        const result = this.createStmtResult(rows, step.stmt);
        stepResults.push(result);
        stepErrors.push(null);
      } catch (error) {
        stepResults.push(null);
        stepErrors.push(this.extractError(error));
      }
    }

    return {
      result: { step_errors: stepErrors, step_results: stepResults },
      type: "ok",
    };
  }

  /**
   * Evaluate a batch condition
   */
  private evaluateCondition(
    condition: HranaBatchCondition | null | undefined,
    stepResults: (HranaStmtResult | null)[],
    stepErrors: (HranaError | null)[],
  ): boolean {
    // No condition means always run
    if (!condition) {
      return true;
    }

    // Check ok condition (step N succeeded)
    if (condition.ok !== undefined) {
      const idx = condition.ok;
      return idx >= 0 && idx < stepResults.length && stepResults[idx] !== null;
    }

    // Check error condition (step N failed)
    if (condition.error !== undefined) {
      const idx = condition.error;
      return idx >= 0 && idx < stepErrors.length && stepErrors[idx] !== null;
    }

    // Check is_autocommit (always true in our implementation)
    if (condition.is_autocommit !== undefined) {
      return condition.is_autocommit;
    }

    // Check NOT condition
    if (condition.not) {
      return !this.evaluateCondition(condition.not, stepResults, stepErrors);
    }

    // Check AND condition
    if (condition.and) {
      return condition.and.every((c) => this.evaluateCondition(c, stepResults, stepErrors));
    }

    // Check OR condition
    if (condition.or) {
      return condition.or.some((c) => this.evaluateCondition(c, stepResults, stepErrors));
    }

    // Unknown condition, default to true
    return true;
  }

  /**
   * Handle sequence request (execute SQL script)
   */
  private async handleSequence(
    request: { sql?: string; sql_id?: number; type: "sequence" },
    adapter: DatabaseAdapter,
  ): Promise<HranaStreamResult> {
    if (!request.sql) {
      return {
        error: { code: "MISSING_SQL", message: "SQL is required for sequence" },
        type: "error",
      };
    }

    try {
      // Split SQL into statements and execute each
      const statements = splitList(request.sql, ";");

      for (const sql of statements) {
        await adapter.execute(sql);
      }

      return { type: "ok" };
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

  /**
   * Handle describe request
   */
  private async handleDescribe(
    request: { sql?: string; sql_id?: number; type: "describe" },
    _adapter: DatabaseAdapter,
  ): Promise<HranaStreamResult> {
    if (!request.sql) {
      return {
        error: { code: "MISSING_SQL", message: "SQL is required for describe" },
        type: "error",
      };
    }

    try {
      const sql = request.sql.toUpperCase();
      const isReadonly = sql.startsWith("SELECT") || sql.startsWith("EXPLAIN");
      const isDdl = sql.startsWith("CREATE") || sql.startsWith("DROP") || sql.startsWith("ALTER");
      const isExplain = sql.startsWith("EXPLAIN");

      // For a real implementation, we'd parse the SQL to get column info
      return {
        result: {
          cols: [],
          is_ddl: isDdl,
          is_explain: isExplain,
          is_readonly: isReadonly,
          params: [],
        },
        type: "ok",
      };
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

  /**
   * Prepare statement from HRANA format
   */
  private prepareStatement(stmt: HranaStmt): { args: unknown[]; sql: string } {
    let sql: string;

    // Resolve SQL from sql_id or direct sql
    if (stmt.sql_id !== undefined && this.currentSession) {
      const storedSql = this.currentSession.storedSql.get(stmt.sql_id);
      if (!storedSql) {
        throw new Error(`Unknown sql_id: ${stmt.sql_id}`);
      }
      sql = storedSql;
    } else {
      sql = stmt.sql ?? "";
    }

    let args: unknown[] = [];

    if (stmt.args) {
      args = stmt.args.map(fromHranaValue);
    } else if (stmt.named_args) {
      // Convert named args to positional
      // This is a simplified approach - real implementation would
      // need to parse SQL and replace named parameters
      args = stmt.named_args.map((arg) => fromHranaValue(arg.value));
    }

    return { args, sql };
  }

  /**
   * Create statement result from query rows
   */
  private createStmtResult(rows: unknown[], stmt: HranaStmt): HranaStmtResult {
    // Convert rows to HRANA format
    const hranaRows: HranaValue[][] = [];
    const cols: HranaColumn[] = [];

    if (rows.length > 0) {
      const firstRow = rows[0] as Record<string, unknown>;
      const columnNames = Object.keys(firstRow);

      // Build column metadata
      for (const name of columnNames) {
        cols.push({ decltype: null, name });
      }

      // Convert each row
      for (const row of rows) {
        const hranaRow: HranaValue[] = [];
        const rowObj = row as Record<string, unknown>;

        for (const name of columnNames) {
          hranaRow.push(toHranaValue(rowObj[name]));
        }

        hranaRows.push(hranaRow);
      }
    }

    return {
      affected_row_count: 0, // Would need adapter support
      cols,
      last_insert_rowid: null, // Would need adapter support
      rows: stmt.want_rows !== false ? hranaRows : [],
      rows_read: hranaRows.length,
      rows_written: 0,
    };
  }

  /**
   * Extract error from exception with proper HRANA error codes
   */
  private extractError(error: unknown): HranaError {
    if (error instanceof Error) {
      const message = error.message;
      const rawCode = (error as { code?: string | number }).code;

      // Map to HRANA error code
      const code = this.mapErrorCode(rawCode, message);

      return { code, message };
    }
    return { code: "UNKNOWN", message: String(error) };
  }

  /**
   * Map database error codes to HRANA/SQLite codes
   */
  private mapErrorCode(rawCode: string | number | undefined, message: string): string {
    // If already a string code, normalize it
    if (typeof rawCode === "string") {
      // SQLite error codes (SQLITE_CONSTRAINT, SQLITE_BUSY, etc.)
      if (rawCode.startsWith("SQLITE_")) {
        return rawCode;
      }
      // libSQL error codes
      if (rawCode.startsWith("LIBSQL_")) {
        return rawCode;
      }
      return rawCode.toUpperCase();
    }

    // Numeric SQLite error codes
    if (typeof rawCode === "number") {
      return this.sqliteErrorCodeToString(rawCode);
    }

    // Try to infer from message
    return this.inferErrorCodeFromMessage(message);
  }

  /**
   * Convert numeric SQLite error code to string
   * @see https://www.sqlite.org/rescode.html
   */
  private sqliteErrorCodeToString(code: number): string {
    // Primary result codes (lower 8 bits)
    const primary = code & 0xff;
    // Extended result codes
    const extended = code;

    // Check extended codes first
    const extendedCodes: Record<number, string> = {
      266: "SQLITE_IOERR_READ",
      275: "SQLITE_CONSTRAINT_CHECK",
      531: "SQLITE_CONSTRAINT_PRIMARYKEY",
      787: "SQLITE_CONSTRAINT_FOREIGNKEY",
      1043: "SQLITE_CONSTRAINT_UNIQUE",
      1299: "SQLITE_CONSTRAINT_NOTNULL",
      1555: "SQLITE_CONSTRAINT_TRIGGER",
      2067: "SQLITE_CONSTRAINT_ROWID",
    };

    if (extendedCodes[extended]) {
      return extendedCodes[extended];
    }

    // Primary codes
    const primaryCodes: Record<number, string> = {
      0: "SQLITE_OK",
      1: "SQLITE_ERROR",
      2: "SQLITE_INTERNAL",
      3: "SQLITE_PERM",
      4: "SQLITE_ABORT",
      5: "SQLITE_BUSY",
      6: "SQLITE_LOCKED",
      7: "SQLITE_NOMEM",
      8: "SQLITE_READONLY",
      9: "SQLITE_INTERRUPT",
      10: "SQLITE_IOERR",
      11: "SQLITE_CORRUPT",
      12: "SQLITE_NOTFOUND",
      13: "SQLITE_FULL",
      14: "SQLITE_CANTOPEN",
      15: "SQLITE_PROTOCOL",
      16: "SQLITE_EMPTY",
      17: "SQLITE_SCHEMA",
      18: "SQLITE_TOOBIG",
      19: "SQLITE_CONSTRAINT",
      20: "SQLITE_MISMATCH",
      21: "SQLITE_MISUSE",
      22: "SQLITE_NOLFS",
      23: "SQLITE_AUTH",
      24: "SQLITE_FORMAT",
      25: "SQLITE_RANGE",
      26: "SQLITE_NOTADB",
      27: "SQLITE_NOTICE",
      28: "SQLITE_WARNING",
      100: "SQLITE_ROW",
      101: "SQLITE_DONE",
    };

    return primaryCodes[primary] ?? `SQLITE_UNKNOWN_${code}`;
  }

  /**
   * Infer error code from error message
   */
  private inferErrorCodeFromMessage(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("unique constraint") || lowerMessage.includes("duplicate")) {
      return "SQLITE_CONSTRAINT_UNIQUE";
    }
    if (lowerMessage.includes("foreign key constraint")) {
      return "SQLITE_CONSTRAINT_FOREIGNKEY";
    }
    if (lowerMessage.includes("not null constraint")) {
      return "SQLITE_CONSTRAINT_NOTNULL";
    }
    if (lowerMessage.includes("primary key constraint")) {
      return "SQLITE_CONSTRAINT_PRIMARYKEY";
    }
    if (lowerMessage.includes("check constraint")) {
      return "SQLITE_CONSTRAINT_CHECK";
    }
    if (lowerMessage.includes("constraint")) {
      return "SQLITE_CONSTRAINT";
    }
    if (lowerMessage.includes("busy") || lowerMessage.includes("locked")) {
      return "SQLITE_BUSY";
    }
    if (lowerMessage.includes("syntax error") || lowerMessage.includes("near")) {
      return "SQLITE_ERROR";
    }
    if (lowerMessage.includes("no such table") || lowerMessage.includes("no such column")) {
      return "SQLITE_ERROR";
    }
    if (lowerMessage.includes("readonly") || lowerMessage.includes("read-only")) {
      return "SQLITE_READONLY";
    }
    if (lowerMessage.includes("authorization") || lowerMessage.includes("permission")) {
      return "SQLITE_AUTH";
    }

    return "SQLITE_ERROR";
  }

  /**
   * Create error result from exception
   */
  private createErrorResult(error: unknown): HranaErrorResult {
    return {
      error: this.extractError(error),
      type: "error",
    };
  }
}
