import type { PluginLogger } from "@buntime/shared/types";
import { BunSqlAdapter } from "./adapters/bun-sql";
import { LibSqlAdapter } from "./adapters/libsql";
import type {
  AdapterConfig,
  DatabaseAdapter,
  DatabasePluginConfig,
  DatabaseService,
} from "./types";

/**
 * Create a database adapter from configuration
 */
function createAdapter(config: AdapterConfig): DatabaseAdapter {
  switch (config.type) {
    case "libsql":
      return new LibSqlAdapter(config);
    case "postgres":
    case "mysql":
    case "sqlite":
      return new BunSqlAdapter(config);
    default:
      throw new Error(`Unknown adapter type: ${(config as AdapterConfig).type}`);
  }
}

export interface DatabaseServiceOptions {
  config: DatabasePluginConfig;
  logger: PluginLogger;
}

/**
 * Database service implementation
 *
 * Manages database adapters and tenant isolation
 */
export class DatabaseServiceImpl implements DatabaseService {
  private readonly adapter: DatabaseAdapter;
  private readonly autoCreate: boolean;
  private readonly logger: PluginLogger;
  private readonly tenantCache = new Map<string, DatabaseAdapter>();

  constructor(options: DatabaseServiceOptions) {
    this.logger = options.logger;
    this.autoCreate = options.config.tenancy?.autoCreate ?? false;

    // Create root adapter
    this.adapter = createAdapter(options.config.adapter);

    this.logger.info(
      `Database service initialized (type: ${options.config.adapter.type}, tenancy: ${options.config.tenancy?.enabled ?? false})`,
    );
  }

  async getAdapter(tenantId?: string): Promise<DatabaseAdapter> {
    if (!tenantId) {
      return this.adapter;
    }

    // Check cache first
    const cached = this.tenantCache.get(tenantId);
    if (cached) {
      return cached;
    }

    // Auto-create tenant if enabled
    if (this.autoCreate) {
      try {
        await this.adapter.createTenant(tenantId);
      } catch (error) {
        // Ignore if already exists
        this.logger.debug(`Tenant ${tenantId} may already exist: ${error}`);
      }
    }

    // Get tenant adapter
    const tenantAdapter = await this.adapter.getTenant(tenantId);
    this.tenantCache.set(tenantId, tenantAdapter);

    return tenantAdapter;
  }

  async createTenant(tenantId: string): Promise<void> {
    await this.adapter.createTenant(tenantId);
    // Clear cache in case it was cached before creation
    this.tenantCache.delete(tenantId);
  }

  async deleteTenant(tenantId: string): Promise<void> {
    // Close cached adapter if exists
    const cached = this.tenantCache.get(tenantId);
    if (cached) {
      await cached.close();
      this.tenantCache.delete(tenantId);
    }

    await this.adapter.deleteTenant(tenantId);
  }

  async listTenants(): Promise<string[]> {
    return this.adapter.listTenants();
  }

  getRootAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  /**
   * Close all adapters
   */
  async close(): Promise<void> {
    // Close all cached tenant adapters
    for (const adapter of this.tenantCache.values()) {
      await adapter.close();
    }
    this.tenantCache.clear();

    // Close root adapter
    await this.adapter.close();
  }
}
