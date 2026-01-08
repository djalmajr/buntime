import { createId } from "@paralleldrive/cuid2";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const businesses = sqliteTable("businesses", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  contact: text("contact"),
  telegram_token: text("telegram_token"),
  payout_pix_key: text("payout_pix_key"),
  fee_model: text("fee_model"),
});
