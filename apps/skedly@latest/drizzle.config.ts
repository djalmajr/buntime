import { defineConfig } from "drizzle-kit";

// Use namespace URL for migrations: skedly.libsql.home
const url = process.env.DATABASE_URL ?? "https://skedly.libsql.home";

export default defineConfig({
  schema: "./server/schemas/*.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
