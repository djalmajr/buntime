/**
 * Buntime Database SDK
 *
 * Provides database access from workers via HRANA protocol.
 *
 * Usage with default adapter:
 * ```typescript
 * import db from "@buntime/database/libsql";
 *
 * const result = await db.execute("SELECT * FROM users");
 * ```
 *
 * Usage with custom configuration:
 * ```typescript
 * import { createClient } from "@buntime/database";
 *
 * const db = createClient({
 *   adapter: "libsql",
 *   namespace: "my-tenant",
 *   baseUrl: "http://localhost:8000/database/api",
 * });
 * ```
 *
 * Usage with Drizzle:
 * ```typescript
 * import { drizzle } from "drizzle-orm/libsql/http";
 * import db from "@buntime/database/libsql";
 * import * as schema from "./schema";
 *
 * const orm = drizzle({ client: db.getRawClient(), schema });
 * const users = await orm.select().from(schema.users);
 * ```
 */

export { createClient, DatabaseClient, LibSqlCompatibleClient } from "./client";
export type {
  AdapterType,
  DatabaseClientConfig,
  HranaColumn,
  HranaError,
  HranaPipelineReqBody,
  HranaPipelineRespBody,
  HranaStmt,
  HranaStmtResult,
  HranaValue,
  ResultSet,
  Row,
  Statement,
  Transaction,
} from "./types";
