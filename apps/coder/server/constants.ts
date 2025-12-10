import z from "zod/v4";
import { number } from "@/utils/zod-helpers";
import { version } from "../package.json";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "staging", "test"]).default("production"),
  PORT: number(4001),
});

const { data, error } = envSchema.safeParse(Bun.env);

if (error) {
  const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
  throw new Error(`Missing/invalid env vars: ${err}`);
}

export const { NODE_ENV, PORT } = data;

export const VERSION = version;
