import type { PluginLogger } from "@buntime/shared/types";

/**
 * KeyVal-like interface (subset of Kv that we need)
 */
export interface KvLike {
  get<T = unknown>(key: unknown[]): Promise<{ value: T | null }>;
  set(key: unknown[], value: unknown): Promise<void>;
  delete(key: unknown[]): Promise<void>;
}

/**
 * Metrics snapshot for historical data
 */
export interface MetricsSnapshot {
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Total requests processed */
  totalRequests: number;
  /** Requests that were blocked */
  blockedRequests: number;
  /** Requests that were allowed */
  allowedRequests: number;
  /** Number of active buckets */
  activeBuckets: number;
}

/**
 * Shell exclude entry
 */
export interface ShellExcludeEntry {
  /** Basename to exclude */
  basename: string;
  /** Source of the exclude (env = from environment, keyval = from persistence) */
  source: "env" | "keyval";
  /** When it was added (only for keyval entries) */
  addedAt?: number;
}

/**
 * Gateway persistence service
 *
 * Stores metrics history and shell excludes in KeyVal.
 */
export class GatewayPersistence {
  private kv: KvLike | null = null;
  private logger: PluginLogger | null = null;
  private snapshotInterval: Timer | null = null;

  // Key prefixes
  private static readonly KEY_PREFIX = "gateway";
  private static readonly METRICS_HISTORY_KEY = ["gateway", "metrics", "history"];
  private static readonly SHELL_EXCLUDES_KEY = ["gateway", "shell", "excludes"];

  // Configuration
  private static readonly MAX_HISTORY_SIZE = 3600; // 1 hour at 1 snapshot/second
  private static readonly SNAPSHOT_INTERVAL_MS = 1000; // 1 second

  /**
   * Initialize persistence with KeyVal service
   */
  async init(kv: KvLike, logger: PluginLogger): Promise<void> {
    this.kv = kv;
    this.logger = logger;
    logger.debug("Gateway persistence initialized");
  }

  /**
   * Check if persistence is available
   */
  isAvailable(): boolean {
    return this.kv !== null;
  }

  /**
   * Start automatic snapshot collection
   */
  startSnapshotCollection(getSnapshot: () => MetricsSnapshot): void {
    if (!this.kv || this.snapshotInterval) return;

    this.snapshotInterval = setInterval(async () => {
      try {
        const snapshot = getSnapshot();
        await this.saveMetricsSnapshot(snapshot);
      } catch (err) {
        this.logger?.error("Failed to save metrics snapshot", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, GatewayPersistence.SNAPSHOT_INTERVAL_MS);

    this.logger?.debug("Started metrics snapshot collection");
  }

  /**
   * Stop automatic snapshot collection
   */
  stopSnapshotCollection(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
      this.logger?.debug("Stopped metrics snapshot collection");
    }
  }

  // =========================================================================
  // Metrics History
  // =========================================================================

  /**
   * Save a metrics snapshot to history
   */
  async saveMetricsSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    if (!this.kv) return;

    try {
      // Get current history
      const entry = await this.kv.get<MetricsSnapshot[]>(GatewayPersistence.METRICS_HISTORY_KEY);
      const history = entry.value ?? [];

      // Add new snapshot
      history.push(snapshot);

      // Trim to max size (keep most recent)
      while (history.length > GatewayPersistence.MAX_HISTORY_SIZE) {
        history.shift();
      }

      // Save back
      await this.kv.set(GatewayPersistence.METRICS_HISTORY_KEY, history);
    } catch (err) {
      this.logger?.error("Failed to save metrics snapshot", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get metrics history
   * @param limit - Maximum number of snapshots to return (most recent first)
   */
  async getMetricsHistory(limit = 60): Promise<MetricsSnapshot[]> {
    if (!this.kv) return [];

    try {
      const entry = await this.kv.get<MetricsSnapshot[]>(GatewayPersistence.METRICS_HISTORY_KEY);
      const history = entry.value ?? [];

      // Return most recent first, limited
      return history.slice(-limit).reverse();
    } catch (err) {
      this.logger?.error("Failed to get metrics history", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Clear metrics history
   */
  async clearMetricsHistory(): Promise<void> {
    if (!this.kv) return;

    try {
      await this.kv.delete(GatewayPersistence.METRICS_HISTORY_KEY);
      this.logger?.debug("Cleared metrics history");
    } catch (err) {
      this.logger?.error("Failed to clear metrics history", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // =========================================================================
  // Shell Excludes
  // =========================================================================

  /**
   * Get shell excludes from KeyVal
   * @returns Array of basenames stored in KeyVal
   */
  async getShellExcludes(): Promise<string[]> {
    if (!this.kv) return [];

    try {
      const entry = await this.kv.get<string[]>(GatewayPersistence.SHELL_EXCLUDES_KEY);
      return entry.value ?? [];
    } catch (err) {
      this.logger?.error("Failed to get shell excludes", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Add a shell exclude to KeyVal
   * @param basename - Basename to add
   * @returns true if added, false if already exists
   */
  async addShellExclude(basename: string): Promise<boolean> {
    if (!this.kv) return false;

    try {
      const excludes = await this.getShellExcludes();

      if (excludes.includes(basename)) {
        return false; // Already exists
      }

      excludes.push(basename);
      await this.kv.set(GatewayPersistence.SHELL_EXCLUDES_KEY, excludes);

      this.logger?.debug(`Added shell exclude: ${basename}`);
      return true;
    } catch (err) {
      this.logger?.error("Failed to add shell exclude", {
        error: err instanceof Error ? err.message : String(err),
        basename,
      });
      return false;
    }
  }

  /**
   * Remove a shell exclude from KeyVal
   * @param basename - Basename to remove
   * @returns true if removed, false if not found
   */
  async removeShellExclude(basename: string): Promise<boolean> {
    if (!this.kv) return false;

    try {
      const excludes = await this.getShellExcludes();
      const index = excludes.indexOf(basename);

      if (index === -1) {
        return false; // Not found
      }

      excludes.splice(index, 1);
      await this.kv.set(GatewayPersistence.SHELL_EXCLUDES_KEY, excludes);

      this.logger?.debug(`Removed shell exclude: ${basename}`);
      return true;
    } catch (err) {
      this.logger?.error("Failed to remove shell exclude", {
        error: err instanceof Error ? err.message : String(err),
        basename,
      });
      return false;
    }
  }

  /**
   * Get all shell excludes with source information
   * @param envExcludes - Set of excludes from environment
   */
  async getAllShellExcludes(envExcludes: Set<string>): Promise<ShellExcludeEntry[]> {
    const result: ShellExcludeEntry[] = [];

    // Add env excludes (non-removable)
    for (const basename of envExcludes) {
      result.push({ basename, source: "env" });
    }

    // Add keyval excludes (removable)
    const keyvalExcludes = await this.getShellExcludes();
    for (const basename of keyvalExcludes) {
      // Don't duplicate if already in env
      if (!envExcludes.has(basename)) {
        result.push({
          basename,
          source: "keyval",
          addedAt: Date.now(), // We don't store this, so approximate
        });
      }
    }

    return result;
  }

  /**
   * Shutdown persistence
   */
  async shutdown(): Promise<void> {
    this.stopSnapshotCollection();
    this.kv = null;
    this.logger = null;
  }
}

/**
 * Create a new GatewayPersistence instance
 */
export function createPersistence(): GatewayPersistence {
  return new GatewayPersistence();
}
