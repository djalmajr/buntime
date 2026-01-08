import { SQL } from "bun";
import type { BunSqlAdapterConfig, DatabaseAdapter, Statement, TransactionAdapter } from "../types";

/**
 * Bun SQL database adapter
 *
 * Uses Bun's native SQL API for postgres, mysql, and sqlite connections.
 *
 * Multi-tenancy strategy by type:
 * - postgres: schemas (1 tenant = 1 schema)
 * - mysql: databases (1 tenant = 1 database)
 * - sqlite: files (1 tenant = 1 .db file)
 */
export class BunSqlAdapter implements DatabaseAdapter {
  readonly type: "mysql" | "postgres" | "sqlite";
  readonly tenantId: string | null;

  private readonly config: BunSqlAdapterConfig;
  private readonly sql: SQL;

  constructor(config: BunSqlAdapterConfig, tenantId: string | null = null) {
    this.config = config;
    this.type = config.type;
    this.tenantId = tenantId;

    // Build connection URL
    let url: string;
    if (tenantId) {
      url = this.buildTenantUrl(config.url ?? "", tenantId);
    } else if (config.url) {
      url = config.url;
    } else if (config.type === "sqlite" && config.baseDir) {
      // Root adapter uses _default.db when no URL is provided
      url = `sqlite://${config.baseDir}/_default.db`;
    } else {
      throw new Error(`URL is required for ${config.type} adapter`);
    }

    this.sql = new SQL(url);
  }

  /**
   * Get the raw Bun SQL client
   */
  getRawClient(): SQL {
    return this.sql;
  }

  /**
   * Build connection URL for tenant based on database type
   */
  private buildTenantUrl(baseUrl: string, tenantId: string): string {
    switch (this.type) {
      case "postgres": {
        // For postgres, we use schemas, so URL stays the same
        // Schema is set via search_path in the query
        return baseUrl;
      }
      case "mysql": {
        // For mysql, append database name to URL
        const url = new URL(baseUrl);
        url.pathname = `/${tenantId}`;
        return url.toString();
      }
      case "sqlite": {
        // For sqlite, use separate file per tenant
        const baseDir = this.config.baseDir ?? "/tmp/buntime";
        return `sqlite://${baseDir}/${tenantId}.db`;
      }
    }
  }

  /**
   * Sanitize tenant ID to prevent SQL injection in schema/database names
   */
  private sanitizeTenantId(tenantId: string): string {
    // Only allow alphanumeric, underscore, and hyphen
    return tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /**
   * Set schema for postgres tenants
   */
  private async setSchemaIfNeeded(): Promise<void> {
    if (this.type === "postgres" && this.tenantId) {
      const schema = this.sanitizeTenantId(this.tenantId);
      await this.sql`SET search_path TO ${this.sql(schema)}, public`;
    }
  }

  async execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]> {
    await this.setSchemaIfNeeded();

    // Use raw SQL with parameters
    // Bun.sql uses tagged templates, but we need to support string SQL
    // We'll use the unsafe option for dynamic SQL
    const result = await this.sql.unsafe(sql, args as (string | number | boolean | null)[]);
    return result as T[];
  }

  async executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null> {
    const rows = await this.execute<T>(sql, args);
    return rows[0] ?? null;
  }

  async batch(statements: Statement[]): Promise<void> {
    // Execute in transaction for atomicity
    await this.transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.execute(stmt.sql, stmt.args);
      }
    });
  }

  async transaction<T>(fn: (tx: TransactionAdapter) => Promise<T>): Promise<T> {
    await this.setSchemaIfNeeded();

    return this.sql.begin(async (tx) => {
      const adapter: TransactionAdapter = {
        execute: async <R = unknown>(sql: string, args?: unknown[]): Promise<R[]> => {
          const result = await tx.unsafe(sql, args as (string | number | boolean | null)[]);
          return result as R[];
        },
        executeOne: async <R = unknown>(sql: string, args?: unknown[]): Promise<R | null> => {
          const result = await tx.unsafe(sql, args as (string | number | boolean | null)[]);
          return (result[0] as R) ?? null;
        },
      };

      return fn(adapter);
    });
  }

  async getTenant(tenantId: string): Promise<DatabaseAdapter> {
    return new BunSqlAdapter(this.config, tenantId);
  }

  async createTenant(tenantId: string): Promise<void> {
    const safeName = this.sanitizeTenantId(tenantId);

    switch (this.type) {
      case "postgres": {
        // Create schema
        await this.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${safeName}`);
        this.config.logger?.info(`Created postgres schema: ${safeName}`);
        break;
      }
      case "mysql": {
        // Create database
        await this.sql.unsafe(`CREATE DATABASE IF NOT EXISTS \`${safeName}\``);
        this.config.logger?.info(`Created mysql database: ${safeName}`);
        break;
      }
      case "sqlite": {
        // SQLite files are created automatically on first access
        // Just verify the directory exists
        const baseDir = this.config.baseDir ?? "/tmp/buntime";
        await Bun.write(`${baseDir}/.keep`, "");
        this.config.logger?.info(`SQLite tenant ready: ${safeName}`);
        break;
      }
    }
  }

  async deleteTenant(tenantId: string): Promise<void> {
    const safeName = this.sanitizeTenantId(tenantId);

    switch (this.type) {
      case "postgres": {
        await this.sql.unsafe(`DROP SCHEMA IF EXISTS ${safeName} CASCADE`);
        this.config.logger?.info(`Deleted postgres schema: ${safeName}`);
        break;
      }
      case "mysql": {
        await this.sql.unsafe(`DROP DATABASE IF EXISTS \`${safeName}\``);
        this.config.logger?.info(`Deleted mysql database: ${safeName}`);
        break;
      }
      case "sqlite": {
        const baseDir = this.config.baseDir ?? "/tmp/buntime";
        const filePath = `${baseDir}/${safeName}.db`;
        const file = Bun.file(filePath);
        if (await file.exists()) {
          await Bun.write(filePath, ""); // Clear file
          // Can't delete file while it might be open, just truncate
        }
        this.config.logger?.info(`Deleted sqlite file: ${safeName}`);
        break;
      }
    }
  }

  async listTenants(): Promise<string[]> {
    switch (this.type) {
      case "postgres": {
        const rows = await this.sql.unsafe<{ schema_name: string }[]>(
          `SELECT schema_name FROM information_schema.schemata
           WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'public', 'pg_toast')`,
        );
        return rows.map((r) => r.schema_name);
      }
      case "mysql": {
        const rows = await this.sql.unsafe<{ schema_name: string }[]>(
          `SELECT schema_name FROM information_schema.schemata
           WHERE schema_name NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')`,
        );
        return rows.map((r) => r.schema_name);
      }
      case "sqlite": {
        // List .db files in baseDir
        const baseDir = this.config.baseDir ?? "/tmp/buntime";
        const glob = new Bun.Glob("*.db");
        const files: string[] = [];
        for await (const file of glob.scan(baseDir)) {
          files.push(file.replace(/\.db$/, ""));
        }
        return files;
      }
    }
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}
