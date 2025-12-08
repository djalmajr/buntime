import { describe, expect, it } from "bun:test";
import { boolean, number } from "./zod-helpers";

describe("zod-helpers", () => {
  describe("number", () => {
    it("should return default value when input is empty string", () => {
      const schema = number(42);
      expect(schema.parse("")).toBe(42);
    });

    it("should return default value when input is null", () => {
      const schema = number(42);
      expect(schema.parse(null)).toBe(42);
    });

    it("should return default value when input is undefined", () => {
      const schema = number(42);
      expect(schema.parse(undefined)).toBe(42);
    });

    it("should parse valid number strings", () => {
      const schema = number(0);
      expect(schema.parse("123")).toBe(123);
      expect(schema.parse("0")).toBe(0);
      expect(schema.parse("8080")).toBe(8080);
    });

    it("should parse negative numbers", () => {
      const schema = number(0);
      expect(schema.parse("-123")).toBe(-123);
    });

    it("should parse decimal numbers", () => {
      const schema = number(0);
      expect(schema.parse("3.14")).toBe(3.14);
    });
  });

  describe("boolean", () => {
    it("should return default value when input is empty string", () => {
      const schema = boolean(true);
      expect(schema.parse("")).toBe(true);

      const schema2 = boolean(false);
      expect(schema2.parse("")).toBe(false);
    });

    it("should return default value when input is null", () => {
      const schema = boolean(true);
      expect(schema.parse(null)).toBe(true);
    });

    it("should return default value when input is undefined", () => {
      const schema = boolean(false);
      expect(schema.parse(undefined)).toBe(false);
    });

    it("should parse boolean values", () => {
      const schema = boolean(false);
      expect(schema.parse(true)).toBe(true);
      expect(schema.parse(false)).toBe(false);
    });

    it("should parse string 'true' as true", () => {
      const schema = boolean(false);
      expect(schema.parse("true")).toBe(true);
    });

    it("should parse string '1' as true", () => {
      const schema = boolean(false);
      expect(schema.parse("1")).toBe(true);
    });

    it("should parse string 'false' as false", () => {
      const schema = boolean(true);
      expect(schema.parse("false")).toBe(false);
    });

    it("should parse string '0' as false", () => {
      const schema = boolean(true);
      expect(schema.parse("0")).toBe(false);
    });

    it("should parse other strings as false", () => {
      const schema = boolean(true);
      expect(schema.parse("anything")).toBe(false);
      expect(schema.parse("yes")).toBe(false);
      expect(schema.parse("no")).toBe(false);
    });
  });
});
