/**
 * Environment-based constants
 *
 * These are the minimal env vars needed at startup.
 * Additional config comes from buntime.jsonc via config.ts
 */
import { number } from "@buntime/shared/utils";
import { z } from "zod";
import { version } from "../package.json";

const envSchema = z.object({
  DELAY_MS: number(100),
  NODE_ENV: z.enum(["development", "production", "staging", "test"]).default("development"),
  PORT: number(8000),
});

const { data, error } = envSchema.safeParse(Bun.env);

if (error) {
  const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
  throw new Error(`Missing/invalid env vars: ${err}`);
}

export const { DELAY_MS, NODE_ENV, PORT } = data;

export const IS_COMPILED = typeof BUNTIME_COMPILED !== "undefined" && BUNTIME_COMPILED;

export const IS_DEV = NODE_ENV === "development";

export const VERSION = version;
