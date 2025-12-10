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
 * Escape bytes that could be confused with separator
 */
function escapeBytes(data: Uint8Array): number[] {
  const escaped: number[] = [];
  for (const byte of data) {
    if (byte === SEPARATOR || byte === ESCAPE) {
      escaped.push(ESCAPE, byte);
    } else {
      escaped.push(byte);
    }
  }
  return escaped;
}

/**
 * Unescape bytes
 */
function unescapeBytes(data: Uint8Array): Uint8Array {
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

/**
 * Encode a single key part to bytes
 */
function encodeKeyPart(part: KvKeyPart): Uint8Array {
  if (part instanceof Uint8Array) {
    const escaped = escapeBytes(part);
    return new Uint8Array([TYPE_TAGS.UINT8ARRAY, ...escaped]);
  }

  if (typeof part === "string") {
    const bytes = new TextEncoder().encode(part);
    const escaped = escapeBytes(bytes);
    return new Uint8Array([TYPE_TAGS.STRING, ...escaped]);
  }

  if (typeof part === "number") {
    // IEEE 754 double encoding with sign bit flipped for sorting
    // Fixed 8-byte representation, no escaping needed (decoder knows the length)
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes[0] = TYPE_TAGS.NUMBER;
    view.setFloat64(1, part, false); // big-endian

    // Flip sign bit for correct ordering
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
    // Encode as length-prefixed big-endian with sign
    // Format: [TAG, signByte, lengthByte, ...valueBytes]
    // signByte: 0x01 = negative, 0x02 = positive
    // lengthByte: number of value bytes (0-255)
    const isNegative = part < 0n;
    const abs = isNegative ? -part : part;
    const hex = abs.toString(16);
    const paddedHex = hex.length % 2 === 0 ? hex : `0${hex}`;
    const valueBytes: number[] = [];

    for (let i = 0; i < paddedHex.length; i += 2) {
      valueBytes.push(parseInt(paddedHex.substring(i, i + 2), 16));
    }

    // Length-prefixed, no escaping needed
    return new Uint8Array([
      TYPE_TAGS.BIGINT,
      isNegative ? 0x01 : 0x02,
      valueBytes.length,
      ...valueBytes,
    ]);
  }

  if (typeof part === "boolean") {
    // Fixed 1-byte representation, no escaping needed
    // Use 0x01 for false, 0x02 for true (avoid 0x00 which is separator)
    return new Uint8Array([TYPE_TAGS.BOOLEAN, part ? 0x02 : 0x01]);
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
      return unescapeBytes(data);
    }

    case TYPE_TAGS.STRING: {
      return new TextDecoder().decode(unescapeBytes(data));
    }

    case TYPE_TAGS.NUMBER: {
      // Fixed 8-byte representation (no escaping)
      if (data.length !== 8) {
        throw new Error("Invalid number encoding");
      }
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      const floatBytes = new Uint8Array(buffer);
      floatBytes.set(data);

      // Reverse sign bit transformation
      const firstByte = floatBytes[0] ?? 0;
      if (firstByte & 0x80) {
        floatBytes[0] = firstByte ^ 0x80; // Positive number
      } else {
        // Negative number
        for (let i = 0; i < floatBytes.length; i++) {
          floatBytes[i] = (floatBytes[i] ?? 0) ^ 0xff;
        }
      }

      return view.getFloat64(0, false);
    }

    case TYPE_TAGS.BIGINT: {
      // Format: [signByte, lengthByte, ...valueBytes]
      if (data.length < 2) {
        throw new Error("Invalid bigint encoding");
      }
      // 0x01 = negative, 0x02 = positive
      const isNegative = data[0] === 0x01;
      const length = data[1] ?? 0;
      const valueBytes = data.slice(2, 2 + length);
      const hex = Array.from(valueBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const value = hex ? BigInt(`0x${hex}`) : 0n;
      return isNegative ? -value : value;
    }

    case TYPE_TAGS.BOOLEAN: {
      // 0x01 = false, 0x02 = true
      return data[0] === 0x02;
    }

    default:
      throw new Error(`Unknown type tag: ${tag}`);
  }
}

/**
 * Get the length of an encoded key part including the type tag
 */
function getEncodedPartLength(bytes: Uint8Array, offset: number): number {
  if (offset >= bytes.length) return 0;

  const tag = bytes[offset];

  switch (tag) {
    case TYPE_TAGS.UINT8ARRAY:
    case TYPE_TAGS.STRING: {
      // Variable length with escaping - scan for unescaped separator or end
      let i = offset + 1;
      while (i < bytes.length) {
        const byte = bytes[i];
        if (byte === ESCAPE && i + 1 < bytes.length) {
          i += 2; // Skip escaped sequence
        } else if (byte === SEPARATOR) {
          break; // Found separator
        } else {
          i++;
        }
      }
      return i - offset;
    }

    case TYPE_TAGS.NUMBER:
      // Fixed 8 bytes after tag
      return 9;

    case TYPE_TAGS.BIGINT: {
      // [tag, sign, length, ...value]
      if (offset + 2 >= bytes.length) return bytes.length - offset;
      const length = bytes[offset + 2] ?? 0;
      return 3 + length;
    }

    case TYPE_TAGS.BOOLEAN:
      // Fixed 1 byte after tag
      return 2;

    default:
      return bytes.length - offset;
  }
}

/**
 * Decode bytes back to a key
 */
export function decodeKey(bytes: Uint8Array): KvKey {
  if (bytes.length === 0) {
    return [];
  }

  const parts: KvKeyPart[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const partLength = getEncodedPartLength(bytes, offset);
    if (partLength === 0) break;

    const partBytes = bytes.slice(offset, offset + partLength);
    parts.push(decodeKeyPart(partBytes));

    offset += partLength;

    // Skip separator if present
    if (offset < bytes.length && bytes[offset] === SEPARATOR) {
      offset++;
    }
  }

  return parts;
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
 * Custom JSON replacer to handle BigInt
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return { __type: "bigint", value: value.toString() };
  }
  return value;
}

/**
 * Custom JSON reviver to restore BigInt
 */
function jsonReviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "__type" in value &&
    "value" in value &&
    (value as { __type: unknown }).__type === "bigint"
  ) {
    return BigInt(String((value as { value: unknown }).value));
  }
  return value;
}

/**
 * Serialize a value for storage
 */
export function serializeValue(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, jsonReplacer));
}

/**
 * Deserialize a value from storage
 */
export function deserializeValue<T>(data: unknown): T | null {
  if (!data) return null;

  if (data instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(data), jsonReviver) as T;
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data)), jsonReviver) as T;
  }

  return null;
}
