import { z } from "zod";
import { number } from "~/helpers/zod-helpers";
import { version } from "../package.json";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "staging", "test"]).default("development"),
  PORT: number(4000),
});

const { data, error } = envSchema.safeParse(Bun.env);

if (error) {
  const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
  throw new Error(`Missing/invalid env vars: ${err}`);
}

export const { NODE_ENV, PORT } = data;

export const IS_DEV = NODE_ENV === "development";

export const VERSION = version;
