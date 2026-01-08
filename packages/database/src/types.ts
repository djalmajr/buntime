/**
 * Database SDK Types
 *
 * These types mirror the HRANA protocol types used by the server.
 */

/**
 * Supported adapter types
 */
export type AdapterType = "libsql" | "mysql" | "postgres" | "sqlite";

/**
 * HRANA Value - represents a SQL value
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
  value: string;
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
  args?: HranaValue[];
  named_args?: HranaNamedArg[];
  sql?: string;
  sql_id?: number;
  want_rows?: boolean;
}

/**
 * Column metadata
 */
export interface HranaColumn {
  decltype?: string | null;
  name: string | null;
}

/**
 * Statement result
 */
export interface HranaStmtResult {
  affected_row_count: number;
  cols: HranaColumn[];
  last_insert_rowid: string | null;
  rows: HranaValue[][];
  rows_read: number;
  rows_written: number;
}

/**
 * HRANA Error
 */
export interface HranaError {
  code?: string | null;
  message: string;
}

/**
 * Stream request types
 */
export interface HranaExecuteRequest {
  stmt: HranaStmt;
  type: "execute";
}

export interface HranaBatchRequest {
  batch: {
    steps: Array<{
      condition?: unknown;
      stmt: HranaStmt;
    }>;
  };
  type: "batch";
}

export interface HranaCloseRequest {
  type: "close";
}

export type HranaStreamRequest = HranaBatchRequest | HranaCloseRequest | HranaExecuteRequest;

/**
 * Stream result types
 */
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
    step_errors: (HranaError | null)[];
    step_results: (HranaStmtResult | null)[];
  };
  type: "ok";
}

export type HranaStreamResult =
  | HranaBatchResult
  | HranaErrorResult
  | HranaExecuteResult
  | HranaOkResult;

/**
 * Pipeline request body
 */
export interface HranaPipelineReqBody {
  baton: string | null;
  requests: HranaStreamRequest[];
}

/**
 * Pipeline response body
 */
export interface HranaPipelineRespBody {
  base_url: string | null;
  baton: string | null;
  results: HranaStreamResult[];
}

/**
 * Result set returned by execute()
 */
export interface ResultSet {
  /** Number of rows affected */
  affectedRows: number;
  /** Column metadata */
  columns: string[];
  /** Last inserted row ID (if applicable) */
  lastInsertRowid: bigint | null;
  /** Result rows as objects */
  rows: Row[];
}

/**
 * Row type - object with column values
 */
export type Row = Record<string, unknown>;

/**
 * Statement for batch execution
 */
export interface Statement {
  args?: unknown[];
  sql: string;
}

/**
 * Transaction interface
 */
export interface Transaction {
  /** Execute a statement in the transaction */
  execute(sql: string, args?: unknown[]): Promise<ResultSet>;

  /** Execute multiple statements in the transaction */
  batch(statements: Statement[]): Promise<ResultSet[]>;

  /** Commit the transaction */
  commit(): Promise<void>;

  /** Rollback the transaction */
  rollback(): Promise<void>;
}

/**
 * Database client configuration
 */
export interface DatabaseClientConfig {
  /** Adapter type */
  adapter: AdapterType;
  /** Base URL for API requests */
  baseUrl?: string;
  /** Namespace/tenant ID */
  namespace?: string;
}

/**
 * Headers used for HRANA requests
 */
export const HranaHeaders = {
  ADAPTER: "x-database-adapter",
  /** Marks request as internal (worker-to-runtime), bypasses CSRF Origin check */
  INTERNAL: "x-buntime-internal",
  NAMESPACE: "x-database-namespace",
} as const;
