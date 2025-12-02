import { z } from "zod";
import { number } from "@/utils/zod-helpers";
import { version } from "../package.json";

const envSchema = z.object({
  APP_SHELL: z.string().optional(),
  APPS_DIR: z.string(),
  DELAY_MS: number(100),
  NODE_ENV: z.enum(["development", "production", "staging", "test"]).default("development"),
  POOL_SIZE: number(10),
  PORT: number(8080),
});

const { data, error } = envSchema.safeParse(Bun.env);

if (error) {
  const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
  throw new Error(`Missing/invalid env vars: ${err}`);
}

export const { APP_SHELL, APPS_DIR, DELAY_MS, NODE_ENV, PORT, POOL_SIZE } = data;

export const IS_COMPILED = typeof BUNTIME_COMPILED !== "undefined" && BUNTIME_COMPILED;

export const IS_DEV = NODE_ENV === "development";

export const VERSION = version;
