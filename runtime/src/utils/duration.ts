import ms, { type StringValue } from "ms";

/**
 * A duration value, either as seconds (number) or a string like "1d", "2h", "30s"
 *
 * @example
 * ```typescript
 * // As number (seconds)
 * { timeout: 30 }
 *
 * // As string (human-readable)
 * { timeout: "30s" }
 * { idleTimeout: "1m" }
 * { ttl: "24h" }
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
 * @param value - Duration as number (seconds) or string ("30s", "1m", "1h")
 * @returns Milliseconds
 * @throws Error if string format is invalid
 *
 * @example
 * ```typescript
 * parseDurationToMs(30);      // 30000 (30 seconds in ms)
 * parseDurationToMs("30s");   // 30000
 * parseDurationToMs("1m");    // 60000
 * parseDurationToMs("1h");    // 3600000
 * ```
 */
export function parseDurationToMs(value: Duration): number {
  if (typeof value === "number") {
    // Numbers are in seconds, convert to milliseconds
    return value * 1000;
  }

  const result = ms(value as StringValue);
  if (result === undefined) {
    throw new Error(`Invalid duration format: "${value}"`);
  }

  return result;
}
