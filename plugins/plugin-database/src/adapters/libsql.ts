import { type Client, createClient } from "@libsql/client/http";
import type { DatabaseAdapter, LibSqlAdapterConfig, Statement, TransactionAdapter } from "../types";

/**
 * LibSQL database adapter
 *
 * Multi-tenancy: Uses namespaces via Admin API
 * - Each tenant gets its own isolated namespace
 * - Namespace selection via URL path: /v1/dev/{namespace}
 */
export class LibSqlAdapter implements DatabaseAdapter {
  readonly type = "libsql" as const;
  readonly tenantId: string | null;

  private readonly adminUrl: string | null;
  private readonly authToken: string | undefined;
  private readonly client: Client;
  private readonly config: LibSqlAdapterConfig;

  constructor(config: LibSqlAdapterConfig, tenantId: string | null = null) {
    this.config = config;
    this.tenantId = tenantId;
    this.authToken = config.authToken;
    this.adminUrl = config.adminUrl ?? null;

    // Build URL for tenant namespace
    const url = tenantId ? this.buildTenantUrl(config.url, tenantId) : config.url;

    this.client = createClient({
      authToken: config.authToken,
      url,
    });
  }

  /**
   * Build URL for tenant namespace
   * Transforms: http://localhost:8080 -> http://localhost:8080/v1/dev/{tenant}
   */
  private buildTenantUrl(baseUrl: string, tenantId: string): string {
    const url = new URL(baseUrl);

    // For HTTP URLs, append namespace path
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.pathname = `/v1/dev/${tenantId}`;
      return url.toString();
    }

    // For file URLs, append tenant to filename
    if (url.protocol === "file:") {
      const basePath = url.pathname.replace(/\.db$/, "");
      return `file:${basePath}_${tenantId}.db`;
    }

    return baseUrl;
  }

  async execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]> {
    const result = await this.client.execute({
      sql,
      args: (args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
    });
    return result.rows as T[];
  }

  async executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null> {
    const rows = await this.execute<T>(sql, args);
    return rows[0] ?? null;
  }

  async batch(statements: Statement[]): Promise<void> {
    await this.client.batch(
      statements.map((s) => ({
        sql: s.sql,
        args: (s.args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
      })),
    );
  }

  async transaction<T>(fn: (tx: TransactionAdapter) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction();

    try {
      const adapter: TransactionAdapter = {
        execute: async <R = unknown>(sql: string, args?: unknown[]): Promise<R[]> => {
          const result = await tx.execute({
            sql,
            args: (args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
          });
          return result.rows as R[];
        },
        executeOne: async <R = unknown>(sql: string, args?: unknown[]): Promise<R | null> => {
          const result = await tx.execute({
            sql,
            args: (args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
          });
          return (result.rows[0] as R) ?? null;
        },
      };

      const result = await fn(adapter);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async getTenant(tenantId: string): Promise<DatabaseAdapter> {
    // Return a new adapter instance for the tenant
    return new LibSqlAdapter(this.config, tenantId);
  }

  async createTenant(tenantId: string): Promise<void> {
    if (!this.adminUrl) {
      this.config.logger?.warn(
        "Admin URL not configured, skipping namespace creation. Namespace will be created on first access.",
      );
      return;
    }

    const response = await fetch(`${this.adminUrl}/v1/namespaces/${tenantId}/create`, {
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined,
      method: "POST",
    });

    if (!response.ok && response.status !== 409) {
      // 409 = already exists
      const text = await response.text();
      throw new Error(`Failed to create namespace ${tenantId}: ${response.status} ${text}`);
    }

    this.config.logger?.info(`Created namespace: ${tenantId}`);
  }

  async deleteTenant(tenantId: string): Promise<void> {
    if (!this.adminUrl) {
      throw new Error("Admin URL not configured, cannot delete namespace");
    }

    const response = await fetch(`${this.adminUrl}/v1/namespaces/${tenantId}`, {
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined,
      method: "DELETE",
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      throw new Error(`Failed to delete namespace ${tenantId}: ${response.status} ${text}`);
    }

    this.config.logger?.info(`Deleted namespace: ${tenantId}`);
  }

  async listTenants(): Promise<string[]> {
    if (!this.adminUrl) {
      throw new Error("Admin URL not configured, cannot list namespaces");
    }

    const response = await fetch(`${this.adminUrl}/v1/namespaces`, {
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list namespaces: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { namespaces?: string[] };
    return data.namespaces ?? [];
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
