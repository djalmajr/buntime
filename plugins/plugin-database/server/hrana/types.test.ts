import { describe, expect, it } from "bun:test";
import { fromHranaValue, HranaHeaders, type HranaValue, toHranaValue } from "./types";

describe("toHranaValue", () => {
  it("should convert null to null type", () => {
    expect(toHranaValue(null)).toEqual({ type: "null" });
  });

  it("should convert undefined to null type", () => {
    expect(toHranaValue(undefined)).toEqual({ type: "null" });
  });

  it("should convert string to text type", () => {
    expect(toHranaValue("hello")).toEqual({ type: "text", value: "hello" });
    expect(toHranaValue("")).toEqual({ type: "text", value: "" });
  });

  it("should convert integer to integer type", () => {
    expect(toHranaValue(42)).toEqual({ type: "integer", value: "42" });
    expect(toHranaValue(0)).toEqual({ type: "integer", value: "0" });
    expect(toHranaValue(-100)).toEqual({ type: "integer", value: "-100" });
  });

  it("should convert float to float type", () => {
    expect(toHranaValue(3.14)).toEqual({ type: "float", value: 3.14 });
    expect(toHranaValue(0.0)).toEqual({ type: "integer", value: "0" }); // 0.0 is integer
    expect(toHranaValue(-2.5)).toEqual({ type: "float", value: -2.5 });
  });

  it("should convert bigint to integer type", () => {
    expect(toHranaValue(BigInt("9007199254740993"))).toEqual({
      type: "integer",
      value: "9007199254740993",
    });
  });

  it("should convert boolean to integer type", () => {
    expect(toHranaValue(true)).toEqual({ type: "integer", value: "1" });
    expect(toHranaValue(false)).toEqual({ type: "integer", value: "0" });
  });

  it("should convert Uint8Array to blob type", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const result = toHranaValue(bytes);
    expect(result.type).toBe("blob");
    expect((result as { base64: string; type: "blob" }).base64).toBe("SGVsbG8=");
  });

  it("should convert ArrayBuffer to blob type", () => {
    const buffer = new ArrayBuffer(3);
    const view = new Uint8Array(buffer);
    view[0] = 1;
    view[1] = 2;
    view[2] = 3;

    const result = toHranaValue(buffer);
    expect(result.type).toBe("blob");
  });

  it("should convert objects to text via String()", () => {
    expect(toHranaValue({ key: "value" })).toEqual({
      type: "text",
      value: "[object Object]",
    });
  });

  it("should convert arrays to text via String()", () => {
    expect(toHranaValue([1, 2, 3])).toEqual({
      type: "text",
      value: "1,2,3",
    });
  });
});

describe("fromHranaValue", () => {
  it("should convert null type to null", () => {
    expect(fromHranaValue({ type: "null" })).toBeNull();
  });

  it("should convert text type to string", () => {
    expect(fromHranaValue({ type: "text", value: "hello" })).toBe("hello");
    expect(fromHranaValue({ type: "text", value: "" })).toBe("");
  });

  it("should convert integer type to number when safe", () => {
    expect(fromHranaValue({ type: "integer", value: "42" })).toBe(42);
    expect(fromHranaValue({ type: "integer", value: "0" })).toBe(0);
    expect(fromHranaValue({ type: "integer", value: "-100" })).toBe(-100);
  });

  it("should convert large integer type to bigint", () => {
    const largeValue = "9007199254740993"; // Larger than MAX_SAFE_INTEGER
    const result = fromHranaValue({ type: "integer", value: largeValue });
    expect(typeof result).toBe("bigint");
    expect(result).toBe(BigInt(largeValue));
  });

  it("should convert float type to number", () => {
    expect(fromHranaValue({ type: "float", value: 3.14 })).toBe(3.14);
    expect(fromHranaValue({ type: "float", value: 0 })).toBe(0);
    expect(fromHranaValue({ type: "float", value: -2.5 })).toBe(-2.5);
  });

  it("should convert blob type to Uint8Array", () => {
    const base64 = "SGVsbG8="; // "Hello"
    const result = fromHranaValue({ type: "blob", base64 }) as Uint8Array;
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(5);
    expect(result[0]).toBe(72); // 'H'
    expect(result[1]).toBe(101); // 'e'
  });

  it("should return null for unknown type", () => {
    const unknownValue = { type: "unknown" } as unknown as HranaValue;
    expect(fromHranaValue(unknownValue)).toBeNull();
  });
});

describe("roundtrip conversion", () => {
  it("should roundtrip null", () => {
    const original = null;
    const hrana = toHranaValue(original);
    const back = fromHranaValue(hrana);
    expect(back).toBe(original);
  });

  it("should roundtrip string", () => {
    const original = "hello world";
    const hrana = toHranaValue(original);
    const back = fromHranaValue(hrana);
    expect(back).toBe(original);
  });

  it("should roundtrip integer", () => {
    const original = 42;
    const hrana = toHranaValue(original);
    const back = fromHranaValue(hrana);
    expect(back).toBe(original);
  });

  it("should roundtrip float", () => {
    const original = 123.456;
    const hrana = toHranaValue(original);
    const back = fromHranaValue(hrana);
    expect(back).toBe(original);
  });

  it("should roundtrip bigint", () => {
    const original = BigInt("9007199254740993");
    const hrana = toHranaValue(original);
    const back = fromHranaValue(hrana);
    expect(back).toBe(original);
  });

  it("should roundtrip Uint8Array", () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const hrana = toHranaValue(original);
    const back = fromHranaValue(hrana) as Uint8Array;
    expect(back).toEqual(original);
  });
});

describe("HranaHeaders", () => {
  it("should have correct header names", () => {
    expect(HranaHeaders.ADAPTER).toBe("x-database-adapter");
    expect(HranaHeaders.NAMESPACE).toBe("x-database-namespace");
  });
});
