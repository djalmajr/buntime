import { HTTPException } from "hono/http-exception";
import type { KvKey, KvKeyPart } from "./types";

/**
 * Maximum depth for key paths
 */
const MAX_KEY_DEPTH = 20;

/**
 * Maximum length for a single string key part (in characters)
 */
const MAX_KEY_PART_LENGTH = 1024;

/**
 * Maximum size for a single Uint8Array key part (in bytes)
 */
const MAX_KEY_PART_BYTES = 1024;

/**
 * Maximum number of keys in a batch operation
 */
const MAX_BATCH_SIZE = 1000;

/**
 * Validates a key part from URL path
 */
function validateKeyPart(part: string): KvKeyPart {
  if (part.length > MAX_KEY_PART_LENGTH) {
    throw new HTTPException(400, {
      message: `Key part too long (max ${MAX_KEY_PART_LENGTH} chars)`,
    });
  }

  // Try to parse as number if it looks numeric
  if (/^-?\d+$/.test(part)) {
    const num = Number(part);
    if (Number.isSafeInteger(num)) {
      return num;
    }
    // If not safe integer, keep as string
  }

  return part;
}

/**
 * Validates and parses a key path from URL
 */
export function validateKeyPath(path: string): KvKey {
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) {
    throw new HTTPException(400, { message: "Key path cannot be empty" });
  }

  if (parts.length > MAX_KEY_DEPTH) {
    throw new HTTPException(400, {
      message: `Key path too deep (max ${MAX_KEY_DEPTH} parts)`,
    });
  }

  return parts.map(validateKeyPart);
}

/**
 * Validates a key from JSON body
 */
export function validateKey(key: unknown): KvKey {
  if (!Array.isArray(key)) {
    throw new HTTPException(400, { message: "Key must be an array" });
  }

  if (key.length === 0) {
    throw new HTTPException(400, { message: "Key cannot be empty" });
  }

  if (key.length > MAX_KEY_DEPTH) {
    throw new HTTPException(400, {
      message: `Key too deep (max ${MAX_KEY_DEPTH} parts)`,
    });
  }

  for (let i = 0; i < key.length; i++) {
    const part = key[i];
    if (
      typeof part !== "string" &&
      typeof part !== "number" &&
      typeof part !== "bigint" &&
      typeof part !== "boolean" &&
      !(part instanceof Uint8Array)
    ) {
      throw new HTTPException(400, {
        message: `Invalid key part at index ${i}: must be string, number, bigint, boolean, or Uint8Array`,
      });
    }

    if (typeof part === "string" && part.length > MAX_KEY_PART_LENGTH) {
      throw new HTTPException(400, {
        message: `Key part at index ${i} too long (max ${MAX_KEY_PART_LENGTH} chars)`,
      });
    }

    if (part instanceof Uint8Array && part.length > MAX_KEY_PART_BYTES) {
      throw new HTTPException(400, {
        message: `Key part at index ${i} too large (max ${MAX_KEY_PART_BYTES} bytes)`,
      });
    }
  }

  return key as KvKey;
}

/**
 * Validates an array of keys for batch operations
 */
export function validateKeys(keys: unknown): KvKey[] {
  if (!Array.isArray(keys)) {
    throw new HTTPException(400, { message: "Keys must be an array" });
  }

  if (keys.length === 0) {
    throw new HTTPException(400, { message: "Keys array cannot be empty" });
  }

  if (keys.length > MAX_BATCH_SIZE) {
    throw new HTTPException(400, {
      message: `Too many keys (max ${MAX_BATCH_SIZE})`,
    });
  }

  return keys.map((key, index) => {
    try {
      return validateKey(key);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw new HTTPException(400, {
          message: `Invalid key at index ${index}: ${error.message}`,
        });
      }
      throw error;
    }
  });
}

/**
 * Validates a BigInt value and checks for safe integer overflow
 */
export function validateBigInt(value: unknown, fieldName = "value"): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HTTPException(400, {
        message: `${fieldName} must be a finite number`,
      });
    }
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      throw new HTTPException(400, {
        message: `${fieldName} is not a valid integer`,
      });
    }
  }

  throw new HTTPException(400, {
    message: `${fieldName} must be a number, bigint, or numeric string`,
  });
}

/**
 * Validates expireIn value
 */
export function validateExpireIn(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    throw new HTTPException(400, {
      message: "expireIn must be a number (milliseconds)",
    });
  }

  const num = typeof value === "string" ? Number.parseInt(value, 10) : value;

  if (!Number.isFinite(num) || num <= 0) {
    throw new HTTPException(400, {
      message: "expireIn must be a positive number",
    });
  }

  return num;
}

/**
 * Validates limit value
 */
export function validateLimit(value: unknown, defaultValue = 100, maxValue = 1000): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const num = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isFinite(num) || num <= 0) {
    throw new HTTPException(400, {
      message: "limit must be a positive number",
    });
  }

  return Math.min(num, maxValue);
}
