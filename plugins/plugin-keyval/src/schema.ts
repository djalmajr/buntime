import type { Client } from "@libsql/client";

/**
 * Initialize the KV database schema
 */
export async function initSchema(client: Client): Promise<void> {
  await client.batch(
    [
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
    ],
    "write",
  );
}

/**
 * Generate a new versionstamp
 * Format: 16 hex characters representing timestamp + random suffix
 */
export function generateVersionstamp(): string {
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return timestamp + random;
}
