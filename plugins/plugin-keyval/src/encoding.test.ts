import { describe, expect, it } from "bun:test";
import {
  decodeKey,
  deserializeValue,
  encodeKey,
  encodePrefixRange,
  serializeValue,
} from "./encoding";

describe("encoding", () => {
  describe("encodeKey/decodeKey", () => {
    it("should encode and decode empty key", () => {
      const key: (string | number)[] = [];
      const encoded = encodeKey(key);
      expect(encoded.length).toBe(0);
      expect(decodeKey(encoded)).toEqual([]);
    });

    it("should encode and decode string key parts", () => {
      const key = ["users", "profile"];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should encode and decode number key parts", () => {
      const key = ["users", 123];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should encode and decode negative numbers", () => {
      const key = ["balance", -100];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should encode and decode bigint key parts", () => {
      const key = ["id", 9007199254740993n];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should encode and decode negative bigint", () => {
      const key = ["value", -123456789012345678901234567890n];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should encode and decode boolean key parts", () => {
      const key = ["active", true, "verified", false];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should encode and decode Uint8Array key parts", () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const key = ["binary", bytes];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded[0]).toBe("binary");
      expect(decoded[1]).toEqual(bytes);
    });

    it("should handle complex mixed keys", () => {
      const key = ["users", 123, "posts", 456n, true];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should escape separator bytes in strings", () => {
      const key = ["hello\x00world"];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });

    it("should maintain lexicographic order for numbers", () => {
      const keys = [
        ["num", -100],
        ["num", -1],
        ["num", 0],
        ["num", 1],
        ["num", 100],
      ];

      const encoded = keys.map(encodeKey);

      for (let i = 0; i < encoded.length - 1; i++) {
        const a = encoded[i]!;
        const b = encoded[i + 1]!;
        const cmp = compareBytes(a, b);
        expect(cmp).toBeLessThan(0);
      }
    });

    it("should maintain lexicographic order for strings", () => {
      const keys = [
        ["str", "a"],
        ["str", "aa"],
        ["str", "ab"],
        ["str", "b"],
        ["str", "z"],
      ];

      const encoded = keys.map(encodeKey);

      for (let i = 0; i < encoded.length - 1; i++) {
        const a = encoded[i]!;
        const b = encoded[i + 1]!;
        const cmp = compareBytes(a, b);
        expect(cmp).toBeLessThan(0);
      }
    });
  });

  describe("encodePrefixRange", () => {
    it("should create valid prefix range", () => {
      const prefix = ["users"];
      const range = encodePrefixRange(prefix);

      expect(range.start).toBeDefined();
      expect(range.end).toBeDefined();
      expect(range.start.length).toBeGreaterThan(0);
      expect(range.end.length).toBeGreaterThan(0);
    });

    it("should include keys with matching prefix", () => {
      const prefix = ["users"];
      const range = encodePrefixRange(prefix);

      const key1 = encodeKey(["users", 1]);
      const key2 = encodeKey(["users", 2]);
      const key3 = encodeKey(["users", "profile"]);

      expect(compareBytes(range.start, key1)).toBeLessThanOrEqual(0);
      expect(compareBytes(key1, range.end)).toBeLessThan(0);

      expect(compareBytes(range.start, key2)).toBeLessThanOrEqual(0);
      expect(compareBytes(key2, range.end)).toBeLessThan(0);

      expect(compareBytes(range.start, key3)).toBeLessThanOrEqual(0);
      expect(compareBytes(key3, range.end)).toBeLessThan(0);
    });

    it("should exclude keys without matching prefix", () => {
      const prefix = ["users"];
      const range = encodePrefixRange(prefix);

      const otherKey = encodeKey(["posts", 1]);

      const inRange =
        compareBytes(range.start, otherKey) <= 0 && compareBytes(otherKey, range.end) < 0;

      expect(inRange).toBe(false);
    });
  });

  describe("encodeKey edge cases", () => {
    it("should throw for unsupported type", () => {
      const key = [Symbol("test")] as unknown as (string | number)[];
      expect(() => encodeKey(key)).toThrow("Unsupported key part type");
    });

    it("should handle zero bigint", () => {
      const key = ["zero", 0n];
      const encoded = encodeKey(key);
      const decoded = decodeKey(encoded);
      expect(decoded).toEqual(key);
    });
  });

  describe("decodeKey edge cases", () => {
    it("should throw for unknown type tag zero", () => {
      // Type tag 0x00 is not valid
      const malformed = new Uint8Array([0x00]);
      expect(() => decodeKey(malformed)).toThrow("Unknown type tag: 0");
    });

    it("should throw for unknown type tag", () => {
      // Create bytes with unknown type tag (0xFF)
      const malformed = new Uint8Array([0xff, 0x01, 0x02]);
      expect(() => decodeKey(malformed)).toThrow("Unknown type tag: 255");
    });

    it("should throw for invalid number encoding", () => {
      // Type tag for number (0x03) but only 4 bytes instead of 8
      const malformed = new Uint8Array([0x03, 0x01, 0x02, 0x03, 0x04]);
      expect(() => decodeKey(malformed)).toThrow("Invalid number encoding");
    });

    it("should throw for invalid bigint encoding", () => {
      // Type tag for bigint (0x04) but only 1 byte (needs at least 2)
      const malformed = new Uint8Array([0x04, 0x01]);
      expect(() => decodeKey(malformed)).toThrow("Invalid bigint encoding");
    });
  });

  describe("serializeValue/deserializeValue", () => {
    it("should serialize and deserialize strings", () => {
      const value = "hello world";
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<string>(serialized);
      expect(deserialized).toBe(value);
    });

    it("should serialize and deserialize numbers", () => {
      const value = 42.5;
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<number>(serialized);
      expect(deserialized).toBe(value);
    });

    it("should serialize and deserialize objects", () => {
      const value = { name: "Alice", age: 30 };
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<typeof value>(serialized);
      expect(deserialized).toEqual(value);
    });

    it("should serialize and deserialize arrays", () => {
      const value = [1, 2, 3, "a", "b", "c"];
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<typeof value>(serialized);
      expect(deserialized).toEqual(value);
    });

    it("should serialize and deserialize null", () => {
      const value = null;
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<null>(serialized);
      expect(deserialized).toBe(null);
    });

    it("should serialize and deserialize boolean", () => {
      expect(deserializeValue<boolean>(serializeValue(true))).toBe(true);
      expect(deserializeValue<boolean>(serializeValue(false))).toBe(false);
    });

    it("should handle complex nested objects", () => {
      const value = {
        nested: {
          array: [1, 2, { deep: true }],
        },
        items: [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
        ],
        status: null,
      };
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<typeof value>(serialized);
      expect(deserialized).toEqual(value);
    });

    it("should return null for empty input", () => {
      expect(deserializeValue(null)).toBe(null);
      expect(deserializeValue(undefined)).toBe(null);
    });

    it("should handle ArrayBuffer input", () => {
      const value = { test: "data" };
      const serialized = serializeValue(value);
      const buffer = serialized.buffer.slice(
        serialized.byteOffset,
        serialized.byteOffset + serialized.byteLength,
      );
      const deserialized = deserializeValue<typeof value>(buffer);
      expect(deserialized).toEqual(value);
    });

    it("should serialize and deserialize bigint values", () => {
      const value = { count: 9007199254740993n };
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<{ count: bigint }>(serialized);
      expect(deserialized?.count).toBe(9007199254740993n);
    });

    it("should serialize and deserialize negative bigint", () => {
      const value = { amount: -123456789012345678901234567890n };
      const serialized = serializeValue(value);
      const deserialized = deserializeValue<{ amount: bigint }>(serialized);
      expect(deserialized?.amount).toBe(-123456789012345678901234567890n);
    });

    it("should return null for unsupported types", () => {
      // deserializeValue only handles Uint8Array and ArrayBuffer
      expect(deserializeValue("string" as unknown)).toBe(null);
      expect(deserializeValue(123 as unknown)).toBe(null);
    });
  });
});

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}
