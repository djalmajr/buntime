/**
 * A size value, either as bytes (number) or a string like "10mb", "1gb"
 *
 * @example
 * ```typescript
 * // As number (bytes)
 * { maxBodySize: 10485760 }
 *
 * // As string (human-readable)
 * { maxBodySize: "10mb" }
 * { maxBodySize: "1gb" }
 * ```
 *
 * Supported string formats:
 * - `Xb` - bytes
 * - `Xkb` - kilobytes (1024 bytes)
 * - `Xmb` - megabytes (1024^2 bytes)
 * - `Xgb` - gigabytes (1024^3 bytes)
 */
export type Size = number | string;

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  gb: 1024 ** 3,
  kb: 1024,
  mb: 1024 ** 2,
};

/**
 * Parse a size value to bytes
 *
 * @param value - Size as number (bytes) or string ("10mb", "1gb")
 * @returns Bytes
 * @throws Error if string format is invalid
 *
 * @example
 * ```typescript
 * parseSizeToBytes(1024);      // 1024
 * parseSizeToBytes("10kb");    // 10240
 * parseSizeToBytes("10mb");    // 10485760
 * parseSizeToBytes("1gb");     // 1073741824
 * ```
 */
export function parseSizeToBytes(value: Size): number {
  if (typeof value === "number") {
    return value;
  }

  const match = value.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) {
    throw new Error(
      `Invalid size format: "${value}". Use format like "10mb", "1gb", or number in bytes.`,
    );
  }

  const num = parseFloat(match[1]!);
  const unit = match[2] || "b";
  const result = Math.floor(num * SIZE_UNITS[unit]!);

  // Security: Validate result is a safe integer to prevent overflow issues
  if (!Number.isFinite(result) || result < 0 || result > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Size value "${value}" results in unsafe number: ${result}`);
  }

  return result;
}
