import type { TursoBindValue, TursoDatabase, TursoService } from "@buntime/plugin-turso";
import type { PluginLogger } from "@buntime/shared/types";
import type { CorsRule } from "./cors";

interface CorsRuleRow {
  id: string;
  name: string;
  origins: string;
  methods: string;
  allowed_headers: string;
  exposed_headers: string;
  credentials: number;
  max_age: number;
  created_at: number;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToCorsRule(row: CorsRuleRow): CorsRule {
  return {
    id: row.id,
    name: row.name,
    origins: parseJsonArray(row.origins),
    methods: parseJsonArray(row.methods),
    allowedHeaders: parseJsonArray(row.allowed_headers),
    exposedHeaders: parseJsonArray(row.exposed_headers),
    credentials: row.credentials === 1,
    maxAge: row.max_age,
    createdAt: row.created_at,
  };
}

/**
 * Gateway storage row for historical metrics.
 */
interface MetricsSnapshotRow {
  active_buckets: number;
  allowed_requests: number;
  blocked_requests: number;
  timestamp: number;
  total_requests: number;
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
  /** Source of the exclude (env = from environment, turso = from persistence) */
  source: "env" | "turso";
  /** When it was added (only for Turso entries) */
  addedAt?: number;
}

const GATEWAY_NAMESPACE = "gateway";

function bindValues(values: unknown[]): TursoBindValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === "bigint" ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string" ||
      value instanceof Uint8Array
    ) {
      return value;
    }

    return JSON.stringify(value);
  });
}

async function run(db: TursoDatabase, sql: string, values: unknown[] = []): Promise<void> {
  await db.prepare(sql).run(...bindValues(values));
}

/**
 * Gateway persistence service
 *
 * Stores metrics history and shell excludes in Turso-owned gateway tables.
 */
export class GatewayPersistence {
  private db: TursoDatabase | null = null;
  private logger: PluginLogger | null = null;
  private turso: TursoService | null = null;
  private snapshotInterval: Timer | null = null;

  // Configuration
  private static readonly MAX_HISTORY_SIZE = 3600; // 1 hour at 1 snapshot/second
  private static readonly SNAPSHOT_INTERVAL_MS = 1000; // 1 second

  /**
   * Initialize persistence with Turso service
   */
  async init(turso: TursoService, logger: PluginLogger): Promise<void> {
    this.turso = turso;
    this.logger = logger;
    this.db = await turso.connect(GATEWAY_NAMESPACE);

    await turso.transaction({ namespace: GATEWAY_NAMESPACE, type: "exclusive" }, async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS gateway_metrics_history (
          timestamp INTEGER PRIMARY KEY,
          total_requests INTEGER NOT NULL,
          blocked_requests INTEGER NOT NULL,
          allowed_requests INTEGER NOT NULL,
          active_buckets INTEGER NOT NULL
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS gateway_shell_excludes (
          basename TEXT PRIMARY KEY,
          added_at INTEGER NOT NULL
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS gateway_cors_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          origins TEXT NOT NULL,
          methods TEXT NOT NULL,
          allowed_headers TEXT NOT NULL,
          exposed_headers TEXT NOT NULL,
          credentials INTEGER NOT NULL,
          max_age INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      await db.exec(`
        CREATE TABLE IF NOT EXISTS gateway_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    });

    logger.debug("Gateway persistence initialized with Turso");
  }

  /**
   * Check if persistence is available
   */
  isAvailable(): boolean {
    return this.db !== null;
  }

  /**
   * Start automatic snapshot collection
   */
  startSnapshotCollection(getSnapshot: () => MetricsSnapshot): void {
    if (!this.db || this.snapshotInterval) return;

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
    if (!this.turso) return;

    try {
      await this.turso.transaction({ namespace: GATEWAY_NAMESPACE }, async (db) => {
        await run(
          db,
          `
            INSERT OR REPLACE INTO gateway_metrics_history (
              timestamp,
              total_requests,
              blocked_requests,
              allowed_requests,
              active_buckets
            ) VALUES (?, ?, ?, ?, ?)
          `,
          [
            snapshot.timestamp,
            snapshot.totalRequests,
            snapshot.blockedRequests,
            snapshot.allowedRequests,
            snapshot.activeBuckets,
          ],
        );
        await run(
          db,
          `
            DELETE FROM gateway_metrics_history
            WHERE timestamp NOT IN (
              SELECT timestamp
              FROM gateway_metrics_history
              ORDER BY timestamp DESC
              LIMIT ?
            )
          `,
          [GatewayPersistence.MAX_HISTORY_SIZE],
        );
      });
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
    if (!this.db) return [];

    try {
      const rows = await this.db
        .prepare(
          "SELECT timestamp, total_requests, blocked_requests, allowed_requests, active_buckets FROM gateway_metrics_history ORDER BY timestamp DESC LIMIT ?",
        )
        .all<MetricsSnapshotRow>(limit);
      return rows.map((row) => ({
        activeBuckets: row.active_buckets,
        allowedRequests: row.allowed_requests,
        blockedRequests: row.blocked_requests,
        timestamp: row.timestamp,
        totalRequests: row.total_requests,
      }));
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
    if (!this.db) return;

    try {
      await this.db.exec("DELETE FROM gateway_metrics_history");
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
   * Get shell excludes from Turso
   * @returns Array of basenames stored in Turso
   */
  async getShellExcludes(): Promise<string[]> {
    if (!this.db) return [];

    try {
      const rows = await this.db
        .prepare("SELECT basename FROM gateway_shell_excludes ORDER BY basename ASC")
        .all<{ basename: string }>();
      return rows.map((row) => row.basename);
    } catch (err) {
      this.logger?.error("Failed to get shell excludes", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Add a shell exclude to Turso
   * @param basename - Basename to add
   * @returns true if added, false if already exists
   */
  async addShellExclude(basename: string): Promise<boolean> {
    if (!this.turso) return false;

    try {
      const added = await this.turso.transaction({ namespace: GATEWAY_NAMESPACE }, async (db) => {
        const existing = await db
          .prepare("SELECT basename FROM gateway_shell_excludes WHERE basename = ?")
          .get<{ basename: string }>(basename);
        if (existing) {
          return false;
        }

        await run(db, "INSERT INTO gateway_shell_excludes (basename, added_at) VALUES (?, ?)", [
          basename,
          Date.now(),
        ]);
        return true;
      });

      if (added) {
        this.logger?.debug(`Added shell exclude: ${basename}`);
      }
      return added;
    } catch (err) {
      this.logger?.error("Failed to add shell exclude", {
        error: err instanceof Error ? err.message : String(err),
        basename,
      });
      return false;
    }
  }

  /**
   * Remove a shell exclude from Turso
   * @param basename - Basename to remove
   * @returns true if removed, false if not found
   */
  async removeShellExclude(basename: string): Promise<boolean> {
    if (!this.turso) return false;

    try {
      const removed = await this.turso.transaction({ namespace: GATEWAY_NAMESPACE }, async (db) => {
        const result = await db
          .prepare("DELETE FROM gateway_shell_excludes WHERE basename = ?")
          .run(basename);
        return result.changes > 0;
      });

      if (removed) {
        this.logger?.debug(`Removed shell exclude: ${basename}`);
      }
      return removed;
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

    // Add persisted excludes (removable)
    const tursoExcludes = await this.getShellExcludes();
    for (const basename of tursoExcludes) {
      // Don't duplicate if already in env
      if (!envExcludes.has(basename)) {
        result.push({
          basename,
          source: "turso",
          addedAt: Date.now(), // We don't store this, so approximate
        });
      }
    }

    return result;
  }

  // =========================================================================
  // CORS Rules (per-domain, runtime-editable)
  // =========================================================================

  /**
   * Get all persisted CORS rules, ordered by creation time.
   *
   * Rules are applied at runtime so operators can tune cross-origin policy
   * per domain without restarting the gateway (which serves other workers and
   * must stay available).
   */
  async getCorsRules(): Promise<CorsRule[]> {
    if (!this.db) return [];

    try {
      const rows = await this.db
        .prepare(
          "SELECT id, name, origins, methods, allowed_headers, exposed_headers, credentials, max_age, created_at FROM gateway_cors_rules ORDER BY created_at ASC",
        )
        .all<CorsRuleRow>();
      return rows.map(rowToCorsRule);
    } catch (err) {
      this.logger?.error("Failed to get CORS rules", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Insert or replace a CORS rule (keyed by id).
   */
  async saveCorsRule(rule: CorsRule): Promise<void> {
    if (!this.turso) return;

    await this.turso.transaction({ namespace: GATEWAY_NAMESPACE }, async (db) => {
      await run(
        db,
        `INSERT OR REPLACE INTO gateway_cors_rules (
          id, name, origins, methods, allowed_headers, exposed_headers, credentials, max_age, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rule.id,
          rule.name,
          JSON.stringify(rule.origins),
          JSON.stringify(rule.methods ?? []),
          JSON.stringify(rule.allowedHeaders ?? []),
          JSON.stringify(rule.exposedHeaders ?? []),
          rule.credentials ? 1 : 0,
          rule.maxAge ?? 86400,
          rule.createdAt ?? Date.now(),
        ],
      );
    });
    this.logger?.debug(`Saved CORS rule: ${rule.name}`);
  }

  /**
   * Delete a CORS rule by id.
   * @returns true if a rule was removed
   */
  async deleteCorsRule(id: string): Promise<boolean> {
    if (!this.turso) return false;

    const removed = await this.turso.transaction({ namespace: GATEWAY_NAMESPACE }, async (db) => {
      const result = await db.prepare("DELETE FROM gateway_cors_rules WHERE id = ?").run(id);
      return result.changes > 0;
    });
    if (removed) this.logger?.debug(`Deleted CORS rule: ${id}`);
    return removed;
  }

  // =========================================================================
  // Settings (generic key/value — runtime overrides seeded by ConfigMap/env)
  // =========================================================================

  /** Read a persisted setting value, or null when unset. */
  async getSetting(key: string): Promise<string | null> {
    if (!this.db) return null;
    try {
      const row = await this.db
        .prepare("SELECT value FROM gateway_settings WHERE key = ?")
        .get<{ value: string }>(key);
      return row?.value ?? null;
    } catch (err) {
      this.logger?.error("Failed to read setting", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** Persist a setting value (runtime override). */
  async setSetting(key: string, value: string): Promise<void> {
    if (!this.turso) return;
    await this.turso.transaction({ namespace: GATEWAY_NAMESPACE }, async (db) => {
      await run(
        db,
        "INSERT OR REPLACE INTO gateway_settings (key, value, updated_at) VALUES (?, ?, ?)",
        [key, value, Date.now()],
      );
    });
  }

  /** Remove a setting override, reverting to the ConfigMap/env seed. */
  async deleteSetting(key: string): Promise<boolean> {
    if (!this.turso) return false;
    return this.turso.transaction({ namespace: GATEWAY_NAMESPACE }, async (db) => {
      const result = await db.prepare("DELETE FROM gateway_settings WHERE key = ?").run(key);
      return result.changes > 0;
    });
  }

  /**
   * Shutdown persistence
   */
  async shutdown(): Promise<void> {
    this.stopSnapshotCollection();
    this.db = null;
    this.logger = null;
    this.turso = null;
  }
}

/**
 * Create a new GatewayPersistence instance
 */
export function createPersistence(): GatewayPersistence {
  return new GatewayPersistence();
}
