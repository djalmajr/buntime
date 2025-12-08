import type { KvKey, KvKeyPart } from "./types";

/**
 * Type tags for key part encoding
 * Order matters for lexicographic sorting
 */
const TYPE_TAGS = {
  UINT8ARRAY: 0x01,
  STRING: 0x02,
  NUMBER: 0x03,
  BIGINT: 0x04,
  BOOLEAN: 0x05,
} as const;

/**
 * Separator between key parts
 */
const SEPARATOR = 0x00;

/**
 * Escape byte for separators within values
 */
const ESCAPE = 0xff;

/**
 * Encode a single key part to bytes
 */
function encodeKeyPart(part: KvKeyPart): Uint8Array {
  if (part instanceof Uint8Array) {
    // Escape any 0x00 bytes in the value
    const escaped: number[] = [TYPE_TAGS.UINT8ARRAY];
    for (const byte of part) {
      if (byte === SEPARATOR || byte === ESCAPE) {
        escaped.push(ESCAPE, byte);
      } else {
        escaped.push(byte);
      }
    }
    return new Uint8Array(escaped);
  }

  if (typeof part === "string") {
    const bytes = new TextEncoder().encode(part);
    const escaped: number[] = [TYPE_TAGS.STRING];
    for (const byte of bytes) {
      if (byte === SEPARATOR || byte === ESCAPE) {
        escaped.push(ESCAPE, byte);
      } else {
        escaped.push(byte);
      }
    }
    return new Uint8Array(escaped);
  }

  if (typeof part === "number") {
    // IEEE 754 double encoding with sign bit flipped for sorting
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, TYPE_TAGS.NUMBER);
    view.setFloat64(1, part, false); // big-endian

    // Flip sign bit for correct ordering
    const bytes = new Uint8Array(buffer);
    if (part >= 0) {
      bytes[1] = (bytes[1] ?? 0) ^ 0x80; // Flip sign bit for positive numbers
    } else {
      // Flip all bits for negative numbers
      for (let i = 1; i < bytes.length; i++) {
        bytes[i] = (bytes[i] ?? 0) ^ 0xff;
      }
    }
    return bytes;
  }

  if (typeof part === "bigint") {
    // Encode as variable-length big-endian with sign
    const isNegative = part < 0n;
    const abs = isNegative ? -part : part;
    const hex = abs.toString(16);
    const paddedHex = hex.length % 2 === 0 ? hex : "0" + hex;
    const bytes: number[] = [TYPE_TAGS.BIGINT, isNegative ? 0x00 : 0x01];

    for (let i = 0; i < paddedHex.length; i += 2) {
      bytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
    }

    return new Uint8Array(bytes);
  }

  if (typeof part === "boolean") {
    return new Uint8Array([TYPE_TAGS.BOOLEAN, part ? 0x01 : 0x00]);
  }

  throw new Error(`Unsupported key part type: ${typeof part}`);
}

/**
 * Encode a full key to bytes for storage
 */
export function encodeKey(key: KvKey): Uint8Array {
  if (key.length === 0) {
    return new Uint8Array(0);
  }

  const parts = key.map(encodeKeyPart);
  const totalLength = parts.reduce((sum, p) => sum + p.length + 1, 0) - 1;
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (i > 0) {
      result[offset++] = SEPARATOR;
    }
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

/**
 * Decode a single key part from bytes
 */
function decodeKeyPart(bytes: Uint8Array): KvKeyPart {
  if (bytes.length === 0) {
    throw new Error("Empty key part");
  }

  const tag = bytes[0];
  const data = bytes.slice(1);

  switch (tag) {
    case TYPE_TAGS.UINT8ARRAY: {
      // Unescape bytes
      const unescaped: number[] = [];
      for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        if (byte === undefined) continue;
        if (byte === ESCAPE && i + 1 < data.length) {
          const nextByte = data[++i];
          if (nextByte !== undefined) unescaped.push(nextByte);
        } else {
          unescaped.push(byte);
        }
      }
      return new Uint8Array(unescaped);
    }

    case TYPE_TAGS.STRING: {
      // Unescape bytes
      const unescaped: number[] = [];
      for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        if (byte === undefined) continue;
        if (byte === ESCAPE && i + 1 < data.length) {
          const nextByte = data[++i];
          if (nextByte !== undefined) unescaped.push(nextByte);
        } else {
          unescaped.push(byte);
        }
      }
      return new TextDecoder().decode(new Uint8Array(unescaped));
    }

    case TYPE_TAGS.NUMBER: {
      if (data.length !== 8) {
        throw new Error("Invalid number encoding");
      }
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      const bytes = new Uint8Array(buffer);
      bytes.set(data);

      // Reverse sign bit transformation
      const firstByte = bytes[0] ?? 0;
      if (firstByte & 0x80) {
        bytes[0] = firstByte ^ 0x80; // Positive number
      } else {
        // Negative number
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = (bytes[i] ?? 0) ^ 0xff;
        }
      }

      return view.getFloat64(0, false);
    }

    case TYPE_TAGS.BIGINT: {
      if (data.length < 1) {
        throw new Error("Invalid bigint encoding");
      }
      const isNegative = data[0] === 0x00;
      const hex = Array.from(data.slice(1))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const value = hex ? BigInt("0x" + hex) : 0n;
      return isNegative ? -value : value;
    }

    case TYPE_TAGS.BOOLEAN: {
      return data[0] === 0x01;
    }

    default:
      throw new Error(`Unknown type tag: ${tag}`);
  }
}

/**
 * Decode bytes back to a key
 */
export function decodeKey(bytes: Uint8Array): KvKey {
  if (bytes.length === 0) {
    return [];
  }

  const parts: Uint8Array[] = [];
  let start = 0;

  for (let i = 0; i < bytes.length; i++) {
    // Check for unescaped separator
    if (bytes[i] === SEPARATOR && (i === 0 || bytes[i - 1] !== ESCAPE)) {
      parts.push(bytes.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(bytes.slice(start));

  return parts.map(decodeKeyPart);
}

/**
 * Encode a prefix key for range queries
 * Returns the encoded prefix that can be used with LIKE or range queries
 */
export function encodePrefixRange(prefix: KvKey): { start: Uint8Array; end: Uint8Array } {
  const encoded = encodeKey(prefix);

  // Start is the prefix with a separator
  const start = new Uint8Array(encoded.length + 1);
  start.set(encoded);
  start[encoded.length] = SEPARATOR;

  // End is the prefix with 0xFF (highest byte value)
  const end = new Uint8Array(encoded.length + 1);
  end.set(encoded);
  end[encoded.length] = 0xff;

  return { start, end };
}

/**
 * Serialize a value for storage
 */
export function serializeValue(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/**
 * Deserialize a value from storage
 */
export function deserializeValue<T>(data: unknown): T | null {
  if (!data) return null;

  if (data instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(data)) as T;
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as T;
  }

  return null;
}
