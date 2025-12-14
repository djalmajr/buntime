import type { DatabaseAdapter } from "@buntime/plugin-database";

/**
 * Operation types tracked by metrics
 */
export type KvOperationType =
  | "atomic_commit"
  | "cleanup"
  | "count"
  | "delete"
  | "get"
  | "list"
  | "paginate"
  | "queue_ack"
  | "queue_dequeue"
  | "queue_enqueue"
  | "queue_nack"
  | "set";

/**
 * Histogram buckets for latency measurements (in ms)
 */
const LATENCY_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * Flush interval for persistent metrics (default: 30 seconds)
 */
const DEFAULT_FLUSH_INTERVAL = 30000;

/**
 * Metrics configuration
 */
export interface KvMetricsConfig {
  /**
   * Database adapter for persistence (optional)
   * If not provided, metrics are only stored in memory
   */
  adapter?: DatabaseAdapter;

  /**
   * Flush interval in ms for persisting metrics
   * @default 30000
   */
  flushInterval?: number;
}

/**
 * Metrics collector for KeyVal operations
 * Provides Prometheus-compatible metrics for monitoring
 * Optionally persists metrics to database
 */
export class KvMetrics {
  private operationCounts = new Map<KvOperationType, number>();
  private operationErrors = new Map<KvOperationType, number>();
  private latencyHistograms = new Map<KvOperationType, Map<number, number>>();
  private latencySums = new Map<KvOperationType, number>();

  private adapter: DatabaseAdapter | null = null;
  private flushTimer: Timer | null = null;
  private pendingUpdates = new Map<
    KvOperationType,
    { count: number; errors: number; latencySum: number }
  >();

  constructor(config?: KvMetricsConfig) {
    this.adapter = config?.adapter ?? null;

    if (this.adapter) {
      // Load existing metrics from database
      this.loadFromDatabase().catch(() => {
        // Ignore load errors - will start fresh
      });

      // Start periodic flush
      const flushInterval = config?.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {
          // Ignore flush errors
        });
      }, flushInterval);
    }
  }

  /**
   * Record an operation with its duration
   */
  recordOperation(operation: KvOperationType, durationMs: number, error = false): void {
    // Increment operation count
    const count = this.operationCounts.get(operation) ?? 0;
    this.operationCounts.set(operation, count + 1);

    // Increment error count if applicable
    if (error) {
      const errorCount = this.operationErrors.get(operation) ?? 0;
      this.operationErrors.set(operation, errorCount + 1);
    }

    // Update latency histogram
    let histogram = this.latencyHistograms.get(operation);
    if (!histogram) {
      histogram = new Map<number, number>();
      for (const bucket of LATENCY_BUCKETS) {
        histogram.set(bucket, 0);
      }
      histogram.set(Infinity, 0); // +Inf bucket
      this.latencyHistograms.set(operation, histogram);
    }

    for (const bucket of LATENCY_BUCKETS) {
      if (durationMs <= bucket) {
        histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
      }
    }
    histogram.set(Infinity, (histogram.get(Infinity) ?? 0) + 1);

    // Update latency sum
    const sum = this.latencySums.get(operation) ?? 0;
    this.latencySums.set(operation, sum + durationMs);

    // Track pending update for persistence
    if (this.adapter) {
      const pending = this.pendingUpdates.get(operation) ?? { count: 0, errors: 0, latencySum: 0 };
      pending.count += 1;
      pending.errors += error ? 1 : 0;
      pending.latencySum += durationMs;
      this.pendingUpdates.set(operation, pending);
    }
  }

  /**
   * Load metrics from database
   */
  private async loadFromDatabase(): Promise<void> {
    if (!this.adapter) return;

    const rows = await this.adapter.execute<{
      count: number;
      errors: number;
      latency_sum: number;
      operation: KvOperationType;
    }>("SELECT operation, count, errors, latency_sum FROM kv_metrics");

    for (const row of rows) {
      this.operationCounts.set(row.operation, row.count);
      this.operationErrors.set(row.operation, row.errors);
      this.latencySums.set(row.operation, row.latency_sum);
    }
  }

  /**
   * Flush pending metrics to database
   */
  async flush(): Promise<void> {
    if (!this.adapter || this.pendingUpdates.size === 0) return;

    const now = Date.now();
    const statements = [];

    for (const [operation, update] of this.pendingUpdates) {
      statements.push({
        sql: `INSERT INTO kv_metrics (id, operation, count, errors, latency_sum, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                count = count + excluded.count,
                errors = errors + excluded.errors,
                latency_sum = latency_sum + excluded.latency_sum,
                updated_at = excluded.updated_at`,
        args: [operation, operation, update.count, update.errors, update.latencySum, now],
      });
    }

    if (statements.length > 0) {
      await this.adapter.batch(statements);
      this.pendingUpdates.clear();
    }
  }

  /**
   * Close the metrics collector and flush pending data
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    await this.flush();
  }

  /**
   * Get metrics as JSON
   */
  toJSON(): Record<string, unknown> {
    const operations: Record<string, { count: number; errors: number; avgLatencyMs: number }> = {};

    for (const [op, count] of this.operationCounts) {
      const errors = this.operationErrors.get(op) ?? 0;
      const sum = this.latencySums.get(op) ?? 0;
      operations[op] = {
        avgLatencyMs: count > 0 ? sum / count : 0,
        count,
        errors,
      };
    }

    return {
      operations,
      totals: {
        errors: Array.from(this.operationErrors.values()).reduce((a, b) => a + b, 0),
        operations: Array.from(this.operationCounts.values()).reduce((a, b) => a + b, 0),
      },
    };
  }

  /**
   * Get metrics in Prometheus format
   */
  toPrometheus(prefix = "keyval"): string {
    const lines: string[] = [];

    // Operation counts
    lines.push(`# HELP ${prefix}_operations_total Total operations by type`);
    lines.push(`# TYPE ${prefix}_operations_total counter`);
    for (const [op, count] of this.operationCounts) {
      lines.push(`${prefix}_operations_total{operation="${op}"} ${count}`);
    }

    // Error counts
    lines.push(`# HELP ${prefix}_errors_total Total errors by operation type`);
    lines.push(`# TYPE ${prefix}_errors_total counter`);
    for (const [op, count] of this.operationErrors) {
      lines.push(`${prefix}_errors_total{operation="${op}"} ${count}`);
    }

    // Latency histograms
    lines.push(`# HELP ${prefix}_operation_duration_ms Operation latency in milliseconds`);
    lines.push(`# TYPE ${prefix}_operation_duration_ms histogram`);
    for (const [op, histogram] of this.latencyHistograms) {
      for (const [bucket, count] of histogram) {
        const le = bucket === Infinity ? "+Inf" : bucket.toString();
        lines.push(`${prefix}_operation_duration_ms_bucket{operation="${op}",le="${le}"} ${count}`);
      }
      const sum = this.latencySums.get(op) ?? 0;
      const count = this.operationCounts.get(op) ?? 0;
      lines.push(`${prefix}_operation_duration_ms_sum{operation="${op}"} ${sum}`);
      lines.push(`${prefix}_operation_duration_ms_count{operation="${op}"} ${count}`);
    }

    return lines.join("\n");
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.operationCounts.clear();
    this.operationErrors.clear();
    this.latencyHistograms.clear();
    this.latencySums.clear();
  }
}
