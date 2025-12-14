import type { BasePluginConfig, PluginLogger } from "@buntime/shared/types";

/**
 * Supported database adapter types
 */
export type AdapterType = "libsql" | "mysql" | "postgres" | "sqlite";

/**
 * SQL statement for batch/transaction operations
 */
export interface Statement {
  args?: unknown[];
  sql: string;
}

/**
 * Transaction adapter interface
 */
export interface TransactionAdapter {
  execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]>;
  executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null>;
}

/**
 * Database adapter interface - abstracts the underlying database
 */
export interface DatabaseAdapter {
  /** Adapter type identifier */
  readonly type: AdapterType;

  /** Current tenant ID (null for root adapter) */
  readonly tenantId: string | null;

  /**
   * Execute a SQL query and return all rows
   */
  execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]>;

  /**
   * Execute a SQL query and return first row or null
   */
  executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null>;

  /**
   * Execute multiple statements in a batch
   */
  batch(statements: Statement[]): Promise<void>;

  /**
   * Execute a function within a transaction
   */
  transaction<T>(fn: (tx: TransactionAdapter) => Promise<T>): Promise<T>;

  /**
   * Get an adapter for a specific tenant
   * Returns a new adapter instance scoped to that tenant
   */
  getTenant(tenantId: string): Promise<DatabaseAdapter>;

  /**
   * Create a new tenant
   * - libsql: creates namespace via Admin API
   * - postgres: creates schema
   * - mysql: creates database
   * - sqlite: creates file
   */
  createTenant(tenantId: string): Promise<void>;

  /**
   * Delete a tenant and all its data
   */
  deleteTenant(tenantId: string): Promise<void>;

  /**
   * List all tenants
   */
  listTenants(): Promise<string[]>;

  /**
   * Close the adapter and release resources
   */
  close(): Promise<void>;
}

/**
 * Configuration for LibSQL adapter
 */
export interface LibSqlAdapterConfig {
  /** Auth token for remote databases */
  authToken?: string;
  /** Logger instance */
  logger?: PluginLogger;
  type: "libsql";
  /**
   * Database URLs (first is primary, rest are replicas)
   * - urls[0] = Primary (writes + reads, also used for Admin API)
   * - urls[1..n] = Replicas (reads only, round-robin)
   */
  urls: string[];
}

/**
 * Configuration for Bun SQL adapter (postgres/mysql/sqlite)
 */
export interface BunSqlAdapterConfig {
  /** Base directory for SQLite files (only for sqlite type) */
  baseDir?: string;
  /** Logger instance */
  logger?: PluginLogger;
  type: "mysql" | "postgres" | "sqlite";
  /** Database connection URL */
  url: string;
}

/**
 * Union type for all adapter configurations
 */
export type AdapterConfig = BunSqlAdapterConfig | LibSqlAdapterConfig;

/**
 * Plugin-database configuration
 */
export interface DatabasePluginConfig extends BasePluginConfig {
  /** Database adapter configuration */
  adapter: AdapterConfig;

  /** Multi-tenancy settings */
  tenancy?: {
    /** Auto-create tenant on first access */
    autoCreate?: boolean;
    /** Default tenant ID when header is not present */
    defaultTenant?: string;
    /** Enable multi-tenancy */
    enabled?: boolean;
    /** HTTP header for tenant identification */
    header?: string;
  };
}

/**
 * Database service exposed to other plugins
 */
export interface DatabaseService {
  /**
   * Get adapter for a specific tenant
   * If tenantId is not provided, uses root adapter
   */
  getAdapter(tenantId?: string): Promise<DatabaseAdapter>;

  /**
   * Create a new tenant
   */
  createTenant(tenantId: string): Promise<void>;

  /**
   * Delete a tenant
   */
  deleteTenant(tenantId: string): Promise<void>;

  /**
   * List all tenants
   */
  listTenants(): Promise<string[]>;

  /**
   * Get the root adapter (no tenant isolation)
   */
  getRootAdapter(): DatabaseAdapter;
}
