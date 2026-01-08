import { describe, expect, it } from "bun:test";
import { parseSizeToBytes } from "./size";

describe("parseSizeToBytes", () => {
  describe("number input", () => {
    it("should return the number as-is", () => {
      expect(parseSizeToBytes(1024)).toBe(1024);
      expect(parseSizeToBytes(0)).toBe(0);
      expect(parseSizeToBytes(10485760)).toBe(10485760);
    });
  });

  describe("string input - bytes", () => {
    it("should parse bytes (b)", () => {
      expect(parseSizeToBytes("100b")).toBe(100);
      expect(parseSizeToBytes("1024b")).toBe(1024);
    });

    it("should parse without unit as bytes", () => {
      expect(parseSizeToBytes("100")).toBe(100);
      expect(parseSizeToBytes("1024")).toBe(1024);
    });
  });

  describe("string input - kilobytes", () => {
    it("should parse kilobytes (kb)", () => {
      expect(parseSizeToBytes("1kb")).toBe(1024);
      expect(parseSizeToBytes("10kb")).toBe(10240);
      expect(parseSizeToBytes("100kb")).toBe(102400);
    });
  });

  describe("string input - megabytes", () => {
    it("should parse megabytes (mb)", () => {
      expect(parseSizeToBytes("1mb")).toBe(1048576);
      expect(parseSizeToBytes("10mb")).toBe(10485760);
      expect(parseSizeToBytes("100mb")).toBe(104857600);
    });
  });

  describe("string input - gigabytes", () => {
    it("should parse gigabytes (gb)", () => {
      expect(parseSizeToBytes("1gb")).toBe(1073741824);
      expect(parseSizeToBytes("2gb")).toBe(2147483648);
    });
  });

  describe("case insensitivity", () => {
    it("should handle uppercase units", () => {
      expect(parseSizeToBytes("10KB")).toBe(10240);
      expect(parseSizeToBytes("10MB")).toBe(10485760);
      expect(parseSizeToBytes("1GB")).toBe(1073741824);
    });

    it("should handle mixed case units", () => {
      expect(parseSizeToBytes("10Kb")).toBe(10240);
      expect(parseSizeToBytes("10Mb")).toBe(10485760);
    });
  });

  describe("decimal values", () => {
    it("should handle decimal values", () => {
      expect(parseSizeToBytes("1.5kb")).toBe(1536); // 1.5 * 1024
      expect(parseSizeToBytes("2.5mb")).toBe(2621440); // 2.5 * 1024 * 1024
    });
  });

  describe("whitespace handling", () => {
    it("should handle whitespace between number and unit", () => {
      expect(parseSizeToBytes("10 kb")).toBe(10240);
      expect(parseSizeToBytes("10  mb")).toBe(10485760);
    });
  });

  describe("error cases", () => {
    it("should throw on invalid format", () => {
      expect(() => parseSizeToBytes("abc")).toThrow("Invalid size format");
      expect(() => parseSizeToBytes("10xyz")).toThrow("Invalid size format");
      expect(() => parseSizeToBytes("")).toThrow("Invalid size format");
      expect(() => parseSizeToBytes("-10mb")).toThrow("Invalid size format");
    });

    it("should throw on unsafe large values", () => {
      // Very large value that would exceed MAX_SAFE_INTEGER
      expect(() => parseSizeToBytes("999999999999999999gb")).toThrow("unsafe number");
    });
  });
});
