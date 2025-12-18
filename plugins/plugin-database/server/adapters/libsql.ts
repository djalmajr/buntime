import { type Client, createClient } from "@libsql/client";
import type { DatabaseAdapter, LibSqlAdapterConfig, Statement, TransactionAdapter } from "../types";

/**
 * LibSQL database adapter
 *
 * Multi-tenancy: Uses namespaces via Admin API
 * - Each tenant gets its own isolated namespace
 * - Namespace selection via URL path: /v1/dev/{namespace}
 *
 * Replication: Supports multiple read replicas for load balancing
 * - urls[0] = Primary (writes + reads)
 * - urls[1..n] = Replicas (reads only, round-robin)
 */
export class LibSqlAdapter implements DatabaseAdapter {
  readonly type = "libsql" as const;
  readonly tenantId: string | null;

  private readonly primaryUrl: string;
  private readonly authToken: string | undefined;
  private readonly client: Client;
  private readonly replicaClients: Client[];
  private readonly config: LibSqlAdapterConfig;

  private replicaIndex = 0;

  constructor(config: LibSqlAdapterConfig, tenantId: string | null = null) {
    if (!config.urls || config.urls.length === 0) {
      throw new Error("LibSqlAdapter requires at least one URL in urls[]");
    }

    this.config = config;
    this.tenantId = tenantId;
    this.authToken = config.authToken;

    // First URL is primary, rest are replicas
    const [primaryUrl, ...replicaUrls] = config.urls.filter((url) => url?.trim());

    if (!primaryUrl) {
      throw new Error("LibSqlAdapter requires at least one valid URL");
    }

    this.primaryUrl = primaryUrl;

    // Build URL for tenant namespace
    const resolvedPrimaryUrl = tenantId ? this.buildTenantUrl(primaryUrl, tenantId) : primaryUrl;

    // Primary client (for writes and as fallback for reads)
    this.client = createClient({
      authToken: config.authToken,
      url: resolvedPrimaryUrl,
    });

    // Create replica clients
    this.replicaClients = replicaUrls.map((url) =>
      createClient({
        authToken: config.authToken,
        url: tenantId ? this.buildTenantUrl(url, tenantId) : url,
      }),
    );

    if (replicaUrls.length > 0) {
      config.logger?.info(
        `LibSQL adapter initialized with ${replicaUrls.length} replica(s)${tenantId ? ` for tenant ${tenantId}` : ""}`,
      );
    }
  }

  /**
   * Get the raw LibSQL client
   */
  getRawClient(): Client {
    return this.client;
  }

  /**
   * Get a client for read operations (uses replicas with round-robin)
   */
  private getReadClient(): Client {
    // If no replicas, use primary
    if (this.replicaClients.length === 0) {
      return this.client;
    }

    // Round-robin between replicas
    const client = this.replicaClients[this.replicaIndex];
    if (!client) {
      // Fallback to primary if replica client is undefined (shouldn't happen)
      return this.client;
    }

    this.replicaIndex = (this.replicaIndex + 1) % this.replicaClients.length;
    return client;
  }

  /**
   * Get a client for write operations (always primary)
   */
  private getWriteClient(): Client {
    return this.client;
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
    // Determine if it's a read or write operation
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE)/i.test(sql);
    const client = isWrite ? this.getWriteClient() : this.getReadClient();

    const result = await client.execute({
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
    // Batch operations are always writes
    const client = this.getWriteClient();
    await client.batch(
      statements.map((s) => ({
        sql: s.sql,
        args: (s.args ?? []) as (string | number | boolean | null | Uint8Array | bigint)[],
      })),
    );
  }

  async transaction<T>(fn: (tx: TransactionAdapter) => Promise<T>): Promise<T> {
    // Transactions are always on primary
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
    // Admin API uses the same endpoint as the primary URL
    const response = await fetch(`${this.primaryUrl}/v1/namespaces/${tenantId}/create`, {
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
    const response = await fetch(`${this.primaryUrl}/v1/namespaces/${tenantId}`, {
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
    const response = await fetch(`${this.primaryUrl}/v1/namespaces`, {
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
    for (const replica of this.replicaClients) {
      replica.close();
    }
  }
}
