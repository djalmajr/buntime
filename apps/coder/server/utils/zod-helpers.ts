import z from "zod/v4";

/**
 * Zod helper to handle number environment variables with default values.
 * Converts empty strings to the default value and parses non-empty values as numbers.
 *
 * @param defaultValue - The default value to use when the env var is empty
 * @param schema - Optional Zod number schema with additional validations (e.g., z.number().nonnegative())
 * @returns A Zod schema that preprocesses the value
 */
export const number = (defaultValue: number, schema: z.ZodNumber = z.number()) => {
  return z.preprocess((v) => (!(v ?? "") ? defaultValue : Number(v)), schema);
};

/**
 * Zod helper to handle boolean environment variables with default values.
 * Converts empty strings to the default value and parses string values as booleans.
 * Accepts: true, false, "true", "false", "1", "0"
 *
 * @param defaultValue - The default value to use when the env var is empty
 * @param schema - Optional Zod boolean schema with additional validations
 * @returns A Zod schema that preprocesses the value
 */
export const boolean = (defaultValue: boolean, schema: z.ZodBoolean = z.boolean()) => {
  return z.preprocess((v) => {
    if (!(v ?? "")) return defaultValue;
    if (typeof v === "boolean") return v;
    return v === "true" || v === "1";
  }, schema);
};
