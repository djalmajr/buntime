import { LibSqlAdapter } from "@buntime/plugin-database";

/**
 * Default libSQL URL for integration tests.
 * Uses environment variable or defaults to local Docker instance.
 */
export const LIBSQL_URL = process.env.LIBSQL_URL_0 ?? "http://localhost:8880";

/**
 * Creates a LibSqlAdapter for integration tests.
 * Uses shared database (no namespace isolation for simplicity).
 */
export function createTestAdapter(): LibSqlAdapter {
  return new LibSqlAdapter({ type: "libsql", urls: [LIBSQL_URL] });
}
