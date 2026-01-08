import type { BasePluginConfig, PluginLogger } from "@buntime/shared/types";
import type { Client as LibSqlClient } from "@libsql/client/http";

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

  /**
   * Get the raw database client for advanced operations
   * Use this when you need to pass the client to external libraries
   */
  getRawClient(): LibSqlClient | unknown;
}

/**
 * Configuration for Bun SQL adapter (postgres/mysql/sqlite)
 */
export interface BunSqlAdapterConfig {
  /** Base directory for SQLite files (only for sqlite type) */
  baseDir?: string;
  /** Mark as default adapter (only one allowed) */
  default?: boolean;
  /** Logger instance */
  logger?: PluginLogger;
  type: "mysql" | "postgres" | "sqlite";
  /** Database connection URL (optional for sqlite with baseDir) */
  url?: string;
}

/**
 * Configuration for LibSQL adapter
 *
 * Multi-tenancy uses subdomain routing with libSQL's --enable-namespaces flag:
 * - Base URL: https://libsql.home
 * - Tenant URL: https://{tenant}.libsql.home
 */
export interface LibSqlAdapterConfig {
  /** Auth token for remote databases */
  authToken?: string;
  /** Mark as default adapter (only one allowed) */
  default?: boolean;
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
 * Union type for all adapter configurations
 */
export type AdapterConfig = BunSqlAdapterConfig | LibSqlAdapterConfig;

/**
 * Plugin-database configuration
 */
export interface DatabasePluginConfig extends BasePluginConfig {
  /**
   * Database adapters configuration (multiple adapters)
   * Each adapter type can only appear once.
   * One adapter should have `default: true`.
   */
  adapters?: AdapterConfig[];

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
    /** Maximum number of tenant adapters to cache per adapter type (default: 1000) */
    maxTenants?: number;
  };
}

/**
 * Database service exposed to other plugins
 */
export interface DatabaseService {
  /**
   * Get adapter for a specific tenant
   * @param type - Adapter type (uses default if not specified)
   * @param tenantId - Tenant ID (uses root adapter if not specified)
   */
  getAdapter(type?: AdapterType, tenantId?: string): Promise<DatabaseAdapter>;

  /**
   * Get the root adapter (no tenant isolation)
   * @param type - Adapter type (uses default if not specified)
   */
  getRootAdapter(type?: AdapterType): DatabaseAdapter;

  /**
   * Create a new tenant on the specified adapter
   * @param tenantId - Tenant ID to create
   * @param type - Adapter type (uses default if not specified)
   */
  createTenant(tenantId: string, type?: AdapterType): Promise<void>;

  /**
   * Delete a tenant from the specified adapter
   * @param tenantId - Tenant ID to delete
   * @param type - Adapter type (uses default if not specified)
   */
  deleteTenant(tenantId: string, type?: AdapterType): Promise<void>;

  /**
   * List all tenants from the specified adapter
   * @param type - Adapter type (uses default if not specified)
   */
  listTenants(type?: AdapterType): Promise<string[]>;

  /**
   * Get the default adapter type
   */
  getDefaultType(): AdapterType;

  /**
   * Get all available adapter types
   */
  getAvailableTypes(): AdapterType[];
}
