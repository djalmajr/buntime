import type { PluginLogger } from "@buntime/shared/types";
import { BunSqlAdapter } from "./adapters/bun-sql";
import { LibSqlAdapter } from "./adapters/libsql";
import type {
  AdapterConfig,
  AdapterType,
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
 * Manages multiple database adapters and tenant isolation.
 * Each adapter type can only appear once.
 * One adapter must be marked as default.
 */
export class DatabaseServiceImpl implements DatabaseService {
  private readonly adapters: Map<AdapterType, DatabaseAdapter>;
  private readonly autoCreate: boolean;
  private readonly defaultType: AdapterType;
  private readonly logger: PluginLogger;
  private readonly tenantCache: Map<AdapterType, Map<string, DatabaseAdapter>>;

  constructor(options: DatabaseServiceOptions) {
    this.logger = options.logger;
    this.autoCreate = options.config.tenancy?.autoCreate ?? false;
    this.adapters = new Map();
    this.tenantCache = new Map();

    // Get adapters array (support both old and new config format)
    const adapterConfigs = this.normalizeAdapters(options.config);

    // Validate and create adapters
    let defaultType: AdapterType | null = null;

    for (const config of adapterConfigs) {
      // Check for duplicate types
      if (this.adapters.has(config.type)) {
        throw new Error(`Duplicate adapter type: ${config.type}. Each type can only appear once.`);
      }

      // Create and store adapter
      const adapter = createAdapter(config);
      this.adapters.set(config.type, adapter);
      this.tenantCache.set(config.type, new Map());

      // Track default
      if (config.default) {
        if (defaultType) {
          throw new Error(
            `Multiple default adapters: ${defaultType} and ${config.type}. Only one can be default.`,
          );
        }
        defaultType = config.type;
      }

      this.logger.debug(`Adapter initialized: ${config.type}${config.default ? " (default)" : ""}`);
    }

    // If no explicit default, use the first adapter
    if (!defaultType && adapterConfigs.length > 0) {
      const firstAdapter = adapterConfigs[0];
      if (firstAdapter) {
        defaultType = firstAdapter.type;
        this.logger.debug(`No explicit default, using first adapter: ${defaultType}`);
      }
    }

    if (!defaultType) {
      throw new Error("No adapters configured. At least one adapter is required.");
    }

    this.defaultType = defaultType;

    const types = Array.from(this.adapters.keys()).join(", ");
    this.logger.info(
      `Database service initialized (adapters: ${types}, default: ${this.defaultType}, tenancy: ${options.config.tenancy?.enabled ?? false})`,
    );
  }

  /**
   * Normalize config to always return an array of adapters
   */
  private normalizeAdapters(config: DatabasePluginConfig): AdapterConfig[] {
    // New format: adapters array
    if (config.adapters && config.adapters.length > 0) {
      return config.adapters;
    }

    // Old format: single adapter (backward compatibility)
    if (config.adapter) {
      // Mark as default if not specified
      return [{ ...config.adapter, default: true }];
    }

    return [];
  }

  /**
   * Get the adapter for a specific type (or default)
   */
  private getAdapterByType(type?: AdapterType): DatabaseAdapter {
    const resolvedType = type ?? this.defaultType;
    const adapter = this.adapters.get(resolvedType);

    if (!adapter) {
      const available = Array.from(this.adapters.keys()).join(", ");
      throw new Error(`Adapter type "${resolvedType}" not configured. Available: ${available}`);
    }

    return adapter;
  }

  async getAdapter(type?: AdapterType, tenantId?: string): Promise<DatabaseAdapter> {
    const adapter = this.getAdapterByType(type);

    if (!tenantId) {
      return adapter;
    }

    const resolvedType = type ?? this.defaultType;
    const typeCache = this.tenantCache.get(resolvedType)!;

    // Check cache first
    const cached = typeCache.get(tenantId);
    if (cached) {
      return cached;
    }

    // Auto-create tenant if enabled
    if (this.autoCreate) {
      try {
        await adapter.createTenant(tenantId);
      } catch (error) {
        // Ignore if already exists
        this.logger.debug(`Tenant ${tenantId} may already exist: ${error}`);
      }
    }

    // Get tenant adapter
    const tenantAdapter = await adapter.getTenant(tenantId);
    typeCache.set(tenantId, tenantAdapter);

    return tenantAdapter;
  }

  async createTenant(tenantId: string, type?: AdapterType): Promise<void> {
    const adapter = this.getAdapterByType(type);
    await adapter.createTenant(tenantId);

    // Clear cache in case it was cached before creation
    const resolvedType = type ?? this.defaultType;
    this.tenantCache.get(resolvedType)?.delete(tenantId);
  }

  async deleteTenant(tenantId: string, type?: AdapterType): Promise<void> {
    const adapter = this.getAdapterByType(type);
    const resolvedType = type ?? this.defaultType;
    const typeCache = this.tenantCache.get(resolvedType);

    // Close cached adapter if exists
    const cached = typeCache?.get(tenantId);
    if (cached) {
      await cached.close();
      typeCache?.delete(tenantId);
    }

    await adapter.deleteTenant(tenantId);
  }

  async listTenants(type?: AdapterType): Promise<string[]> {
    const adapter = this.getAdapterByType(type);
    return adapter.listTenants();
  }

  getRootAdapter(type?: AdapterType): DatabaseAdapter {
    return this.getAdapterByType(type);
  }

  getDefaultType(): AdapterType {
    return this.defaultType;
  }

  getAvailableTypes(): AdapterType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Close all adapters
   */
  async close(): Promise<void> {
    // Close all cached tenant adapters
    for (const typeCache of this.tenantCache.values()) {
      for (const adapter of typeCache.values()) {
        await adapter.close();
      }
      typeCache.clear();
    }

    // Close all root adapters
    for (const adapter of this.adapters.values()) {
      await adapter.close();
    }
    this.adapters.clear();
  }
}
