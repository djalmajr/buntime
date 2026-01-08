import { createClient } from "@buntime/database/libsql";
import type { Client } from "@libsql/client/http";
import { drizzle } from "drizzle-orm/libsql/http";
import * as schema from "../schemas";

// App defines its own namespace explicitly
const db = createClient({
  adapter: "libsql",
  namespace: "skedly",
});

export const getDb = () => {
  const client = db.getRawClient() as unknown as Client;
  return drizzle({ client, schema });
};

export type DB = ReturnType<typeof getDb>;
