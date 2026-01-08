/**
 * HRANA 3 Protocol Types (Simplified)
 *
 * Based on the HRANA 3 specification from libSQL/Turso.
 * This is a simplified subset focused on:
 * - execute (single statement)
 * - batch (multiple statements)
 * - transactions via baton
 *
 * @see https://github.com/tursodatabase/libsql/blob/main/docs/HRANA_3_SPEC.md
 */

/**
 * HRANA Value - represents a SQL value
 *
 * HRANA uses a union type with a "type" discriminator.
 * We support a simplified version for now.
 */
export type HranaValue =
  | HranaBlobValue
  | HranaFloatValue
  | HranaIntegerValue
  | HranaNullValue
  | HranaTextValue;

export interface HranaNullValue {
  type: "null";
}

export interface HranaIntegerValue {
  type: "integer";
  value: string; // Integers are sent as strings to avoid precision loss
}

export interface HranaFloatValue {
  type: "float";
  value: number;
}

export interface HranaTextValue {
  type: "text";
  value: string;
}

export interface HranaBlobValue {
  base64: string;
  type: "blob";
}

/**
 * Named argument for SQL statement
 */
export interface HranaNamedArg {
  name: string;
  value: HranaValue;
}

/**
 * SQL Statement
 */
export interface HranaStmt {
  /** Positional arguments (mutually exclusive with named_args) */
  args?: HranaValue[];
  /** Named arguments (mutually exclusive with args) */
  named_args?: HranaNamedArg[];
  /** SQL query string (required if sql_id is not set) */
  sql?: string;
  /** ID of a stored SQL (for prepared statements) */
  sql_id?: number;
  /** Whether to return rows (default: true) */
  want_rows?: boolean;
}

/**
 * Batch step - execute a statement conditionally
 */
export interface HranaBatchStep {
  /** Condition to run this step (null = always run) */
  condition?: HranaBatchCondition | null;
  /** Statement to execute */
  stmt: HranaStmt;
}

/**
 * Batch condition types
 */
export interface HranaBatchCondition {
  /** Run if step N succeeded */
  ok?: number;
  /** Run if step N failed */
  error?: number;
  /** Logical NOT */
  not?: HranaBatchCondition;
  /** Logical AND */
  and?: HranaBatchCondition[];
  /** Logical OR */
  or?: HranaBatchCondition[];
  /** Always true */
  is_autocommit?: boolean;
}

/**
 * Column metadata in result set
 */
export interface HranaColumn {
  /** Column name (may be null for expressions) */
  name: string | null;
  /** Column declared type (SQLite only) */
  decltype?: string | null;
}

/**
 * Execution result for a single statement
 */
export interface HranaStmtResult {
  /** Number of rows affected by the statement */
  affected_row_count: number;
  /** Column metadata */
  cols: HranaColumn[];
  /** Last inserted rowid (SQLite only) */
  last_insert_rowid: string | null;
  /** Number of rows replication-index (for consistency) */
  replication_index?: string | null;
  /** Result rows (each row is an array of values) */
  rows: HranaValue[][];
  /** Total number of rows changed in this connection */
  rows_read: number;
  /** Total number of rows written in this connection */
  rows_written: number;
}

/**
 * Stream request types
 */
export type HranaStreamRequest =
  | HranaBatchRequest
  | HranaCloseRequest
  | HranaCloseSqlRequest
  | HranaDescribeRequest
  | HranaExecuteRequest
  | HranaGetAutocommitRequest
  | HranaSequenceRequest
  | HranaStoreSqlRequest;

export interface HranaCloseRequest {
  type: "close";
}

export interface HranaExecuteRequest {
  stmt: HranaStmt;
  type: "execute";
}

export interface HranaBatchRequest {
  batch: {
    steps: HranaBatchStep[];
  };
  type: "batch";
}

export interface HranaSequenceRequest {
  /** SQL script to execute */
  sql?: string;
  /** ID of stored SQL */
  sql_id?: number;
  type: "sequence";
}

export interface HranaDescribeRequest {
  /** SQL to describe */
  sql?: string;
  /** ID of stored SQL */
  sql_id?: number;
  type: "describe";
}

export interface HranaStoreSqlRequest {
  /** SQL to store */
  sql: string;
  /** ID to assign */
  sql_id: number;
  type: "store_sql";
}

export interface HranaCloseSqlRequest {
  /** ID of SQL to close */
  sql_id: number;
  type: "close_sql";
}

export interface HranaGetAutocommitRequest {
  type: "get_autocommit";
}

/**
 * Stream result types
 */
export type HranaStreamResult =
  | HranaBatchResult
  | HranaCloseResult
  | HranaCloseSqlResult
  | HranaDescribeResult
  | HranaErrorResult
  | HranaExecuteResult
  | HranaGetAutocommitResult
  | HranaSequenceResult
  | HranaStoreSqlResult;

export interface HranaOkResult {
  type: "ok";
}

export interface HranaErrorResult {
  error: HranaError;
  type: "error";
}

export interface HranaExecuteResult {
  result: HranaStmtResult;
  type: "ok";
}

export interface HranaBatchResult {
  result: {
    /** Results for each step (null if step was skipped) */
    step_errors: (HranaError | null)[];
    /** Results for each step (null if step failed) */
    step_results: (HranaStmtResult | null)[];
  };
  type: "ok";
}

export interface HranaSequenceResult {
  type: "ok";
}

export interface HranaDescribeResult {
  result: {
    /** Is this a DDL statement */
    is_ddl: boolean;
    /** Is this an EXPLAIN statement */
    is_explain: boolean;
    /** Is this a read-only statement */
    is_readonly: boolean;
    /** Columns returned */
    cols: HranaColumn[];
    /** Parameters in the statement */
    params: { name: string | null }[];
  };
  type: "ok";
}

export interface HranaStoreSqlResult {
  type: "ok";
}

export interface HranaCloseSqlResult {
  type: "ok";
}

export interface HranaCloseResult {
  type: "ok";
}

export interface HranaGetAutocommitResult {
  is_autocommit: boolean;
  type: "ok";
}

/**
 * HRANA Error
 */
export interface HranaError {
  /** Error code (SQLite error code or custom) */
  code?: string | null;
  /** Error message */
  message: string;
}

/**
 * Pipeline request body
 *
 * This is the main request format for the /pipeline endpoint.
 */
export interface HranaPipelineReqBody {
  /**
   * Baton for session continuity
   *
   * If null, a new session is created.
   * If set, the server will resume the existing session.
   * Sessions are used for transactions.
   */
  baton: string | null;
  /** Stream requests to execute */
  requests: HranaStreamRequest[];
}

/**
 * Pipeline response body
 */
export interface HranaPipelineRespBody {
  /**
   * Base URL for subsequent requests
   *
   * May be set when the server wants the client to
   * send future requests to a different URL.
   */
  base_url: string | null;
  /**
   * Baton for session continuity
   *
   * Return this baton in the next request to continue
   * the session (e.g., for transactions).
   * If null, the session was closed.
   */
  baton: string | null;
  /** Results for each request */
  results: HranaStreamResult[];
}

/**
 * Headers used for HRANA requests
 */
export const HranaHeaders = {
  /** Adapter type to use (libsql, sqlite, postgres, mysql) */
  ADAPTER: "x-database-adapter",
  /** Namespace/tenant ID */
  NAMESPACE: "x-database-namespace",
} as const;

/**
 * Convert a JavaScript value to HRANA value
 */
export function toHranaValue(value: unknown): HranaValue {
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
export function fromHranaValue(value: HranaValue): unknown {
  switch (value.type) {
    case "null":
      return null;
    case "text":
      return value.value;
    case "integer": {
      // Try to return as number if safe, otherwise as bigint
      const num = Number(value.value);
      if (Number.isSafeInteger(num)) {
        return num;
      }
      return BigInt(value.value);
    }
    case "float":
      return value.value;
    case "blob": {
      // Decode base64 to Uint8Array
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
