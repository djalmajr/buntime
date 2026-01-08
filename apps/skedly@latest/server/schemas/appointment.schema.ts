import { createId } from "@paralleldrive/cuid2";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./user.schema";

export const appointments = sqliteTable("appointments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "set null" }),
  start_time: integer("start_time", { mode: "timestamp_ms" }).notNull(),
  end_time: integer("end_time", { mode: "timestamp_ms" }).notNull(),
  status: text("status").notNull().default("pending"),
  total_amount: integer("total_amount").notNull(),
  openpix_transaction_id: text("openpix_transaction_id"),
});
