import ms, { type StringValue } from "ms";

/**
 * A duration value, either as milliseconds (number) or a string like "1d", "2h", "30s"
 *
 * @example
 * ```typescript
 * // As number (milliseconds)
 * { expiresIn: 86400000 }
 *
 * // As string (human-readable)
 * { expiresIn: "1d" }
 * { expiresIn: "24h" }
 * { expiresIn: "30s" }
 * { expiresIn: "500ms" }
 * ```
 *
 * Supported string formats:
 * - `Xms` - milliseconds
 * - `Xs` - seconds
 * - `Xm` - minutes
 * - `Xh` - hours
 * - `Xd` - days
 * - `Xw` - weeks
 * - `Xy` - years
 */
export type Duration = number | string;

/**
 * Parse a duration value to milliseconds
 *
 * @param value - Duration as number (ms) or string ("1d", "2h", "30s")
 * @returns Milliseconds
 * @throws Error if string format is invalid
 *
 * @example
 * ```typescript
 * parseDuration(1000);     // 1000
 * parseDuration("1s");     // 1000
 * parseDuration("1m");     // 60000
 * parseDuration("1h");     // 3600000
 * parseDuration("1d");     // 86400000
 * ```
 */
export function parseDuration(value: Duration): number {
  if (typeof value === "number") {
    return value;
  }

  const result = ms(value as StringValue);
  if (result === undefined) {
    throw new Error(`Invalid duration format: "${value}"`);
  }

  return result;
}

/**
 * Parse an optional duration value to milliseconds
 *
 * @param value - Duration as number (ms), string ("1d", "2h", "30s"), or undefined
 * @returns Milliseconds or undefined
 */
export function parseDurationOptional(value: Duration | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseDuration(value);
}

/**
 * Parse an array of duration values to milliseconds
 *
 * @param values - Array of durations
 * @returns Array of milliseconds
 *
 * @example
 * ```typescript
 * parseDurationArray([1000, "5s", "30s"]);  // [1000, 5000, 30000]
 * ```
 */
export function parseDurationArray(values: Duration[]): number[] {
  return values.map(parseDuration);
}
