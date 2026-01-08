/**
 * LibSQL Database Client
 *
 * Usage:
 * ```typescript
 * import db from "@buntime/database/libsql";
 *
 * const result = await db.execute("SELECT * FROM users");
 * ```
 */

import { DatabaseClient } from "./client";

/**
 * Default LibSQL database client
 *
 * This client communicates with the HRANA server using the libsql adapter.
 */
const db = new DatabaseClient({ adapter: "libsql" });

export default db;

// Re-export types and client class for advanced usage
export { createClient, DatabaseClient, LibSqlCompatibleClient } from "./client";
export type {
  AdapterType,
  DatabaseClientConfig,
  ResultSet,
  Row,
  Statement,
  Transaction,
} from "./types";
