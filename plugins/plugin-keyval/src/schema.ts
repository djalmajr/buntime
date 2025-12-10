import type { DatabaseAdapter } from "@buntime/plugin-database";

/**
 * Initialize the KV database schema
 */
export async function initSchema(adapter: DatabaseAdapter): Promise<void> {
  await adapter.batch([
    // KV entries table
    {
      sql: `CREATE TABLE IF NOT EXISTS kv_entries (
          key BLOB PRIMARY KEY,
          value BLOB NOT NULL,
          versionstamp TEXT NOT NULL,
          expires_at INTEGER
        )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_kv_expires
              ON kv_entries(expires_at)
              WHERE expires_at IS NOT NULL`,
      args: [],
    },
    // Queue table
    {
      sql: `CREATE TABLE IF NOT EXISTS kv_queue (
          id TEXT PRIMARY KEY,
          value BLOB NOT NULL,
          ready_at INTEGER NOT NULL,
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 5,
          backoff_schedule TEXT,
          keys_if_undelivered TEXT,
          status TEXT DEFAULT 'pending',
          locked_until INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_queue_ready
              ON kv_queue(status, ready_at)
              WHERE status = 'pending'`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_queue_locked
              ON kv_queue(locked_until)
              WHERE status = 'processing'`,
      args: [],
    },
    // Dead Letter Queue table
    {
      sql: `CREATE TABLE IF NOT EXISTS kv_dlq (
          id TEXT PRIMARY KEY,
          original_id TEXT NOT NULL,
          value BLOB NOT NULL,
          error_message TEXT,
          attempts INTEGER NOT NULL,
          original_created_at INTEGER NOT NULL,
          failed_at INTEGER NOT NULL
        )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_dlq_failed_at
              ON kv_dlq(failed_at)`,
      args: [],
    },
    // Metrics table for persistent metrics
    {
      sql: `CREATE TABLE IF NOT EXISTS kv_metrics (
          id TEXT PRIMARY KEY,
          operation TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          errors INTEGER NOT NULL DEFAULT 0,
          latency_sum REAL NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_metrics_operation
              ON kv_metrics(operation)`,
      args: [],
    },
  ]);
}
