import { createId } from "@paralleldrive/cuid2";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { businesses } from "./business.schema";

export const services = sqliteTable("services", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  business_id: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(),
  duration_minutes: integer("duration_minutes").notNull(),
  interval_minutes: integer("interval_minutes").notNull(),
});
